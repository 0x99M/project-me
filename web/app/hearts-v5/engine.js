/* eslint-disable */
// The /hearts-v5 engine: a real fluid simulation (stable fluids on the GPU). Gold and rose ink swirl in dark water
// under her finger; when she lets go the water calms, two streams trace a heart, and the two inks settle into it,
// gold on the left and rose on the right, meeting down the middle. Touch it again and it breaks up, then returns.
// startHeartsV5(root) returns a cleanup.
export function startHeartsV5(root){
  "use strict";
  var dead = false, raf = 0, offs = [];
  function on(el, type, fn, opt) { el.addEventListener(type, fn, opt); offs.push(function () { el.removeEventListener(type, fn, opt); }); }
  var stage = root.querySelector('#stage'), canvas = root.querySelector('#gl');
  var capEl = root.querySelector('#cap'), endEl = root.querySelector('#end'), hintEl = root.querySelector('#hint');
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SMALL = Math.min(innerWidth, innerHeight) < 700;

  var P = {
    SIM: SMALL ? 112 : 128, DYE: SMALL ? 640 : 1024, ITER: 20, CURL: REDUCED ? 8 : 24,
    VEL_DISS: 0.3, DYE_DISS: 0.34, PRESSURE: 0.8, RADIUS: 0.0022, FORCE: 5200
  };
  var GOLD = [1.0, 0.62, 0.22], ROSE = [1.0, 0.2, 0.42];

  /* ---------- context ---------- */
  var ctx = getContext(canvas);
  if (!ctx) { capEl.textContent = 'هذا المتصفّح لا يستطيع عرض هذه الصفحة.'; hintEl.hidden = true; return function () {}; }
  var gl = ctx.gl;

  function getContext(cv) {
    var o = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var g = cv.getContext('webgl2', o), two = !!g;
    if (!g) g = cv.getContext('webgl', o) || cv.getContext('experimental-webgl', o);
    if (!g) return null;
    var half, linear;
    if (two) { g.getExtension('EXT_color_buffer_float'); linear = true; }
    else { half = g.getExtension('OES_texture_half_float'); linear = !!g.getExtension('OES_texture_half_float_linear'); }
    var type = two ? g.HALF_FLOAT : half && half.HALF_FLOAT_OES;
    if (!type) return null;
    var rgba, rg, r;
    if (two) { rgba = fmt(g, g.RGBA16F, g.RGBA, type); rg = fmt(g, g.RG16F, g.RG, type); r = fmt(g, g.R16F, g.RED, type); }
    else { rgba = rg = r = fmt(g, g.RGBA, g.RGBA, type); }
    if (!rgba || !rg || !r) return null;
    return { gl: g, type: type, rgba: rgba, rg: rg, r: r, linear: linear };
  }
  function fmt(g, internal, format, type) {
    if (renders(g, internal, format, type)) return { internal: internal, format: format };
    if (g.R16F && internal === g.R16F) return fmt(g, g.RG16F, g.RG, type);
    if (g.RG16F && internal === g.RG16F) return fmt(g, g.RGBA16F, g.RGBA, type);
    return null;
  }
  function renders(g, internal, format, type) {
    var t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
    var f = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, f);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
    var ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
    g.bindFramebuffer(g.FRAMEBUFFER, null); g.deleteFramebuffer(f); g.deleteTexture(t);
    return ok;
  }

  /* ---------- shaders ---------- */
  var HEAD = 'precision highp float;precision highp sampler2D;\n';
  var VARY = 'varying vec2 vUv,vL,vR,vT,vB;\n';
  var HEART = [
    'uniform vec3 uHeart;', // aspect, scale, tip y
    'vec2 toHeart(vec2 uv){return vec2((uv.x-.5)*uHeart.x,uv.y-uHeart.z)/uHeart.y;}',
    'float dot2(vec2 v){return dot(v,v);}',
    'float sdHeart(vec2 p){p.x=abs(p.x);',
    ' if(p.y+p.x>1.)return sqrt(dot2(p-vec2(.25,.75)))-.35355;',
    ' return sqrt(min(dot2(p-vec2(0.,1.)),dot2(p-.5*max(p.x+p.y,0.))))*sign(p.x-p.y);}',
    'vec2 heartGrad(vec2 p){float e=.01;vec2 g=vec2(sdHeart(p+vec2(e,0.))-sdHeart(p-vec2(e,0.)),sdHeart(p+vec2(0.,e))-sdHeart(p-vec2(0.,e)));return g/(length(g)+1e-6);}'
  ].join('\n') + '\n';

  var SRC = {
    vert: HEAD + 'attribute vec2 aPosition;uniform vec2 texelSize;' + VARY +
      'void main(){vUv=aPosition*.5+.5;vL=vUv-vec2(texelSize.x,0.);vR=vUv+vec2(texelSize.x,0.);vT=vUv+vec2(0.,texelSize.y);vB=vUv-vec2(0.,texelSize.y);gl_Position=vec4(aPosition,0.,1.);}',
    copy: HEAD + VARY + 'uniform sampler2D uTexture;void main(){gl_FragColor=texture2D(uTexture,vUv);}',
    clear: HEAD + VARY + 'uniform sampler2D uTexture;uniform float value;void main(){gl_FragColor=value*texture2D(uTexture,vUv);}',
    splat: HEAD + VARY + 'uniform sampler2D uTarget;uniform float aspectRatio,radius;uniform vec3 color;uniform vec2 point;' +
      'void main(){vec2 p=vUv-point;p.x*=aspectRatio;vec3 s=exp(-dot(p,p)/radius)*color;gl_FragColor=vec4(texture2D(uTarget,vUv).xyz+s,1.);}',
    advect: HEAD + VARY + HEART +
      'uniform sampler2D uVelocity,uSource;uniform vec2 texelSize,dyeTexelSize;uniform float dt,dissipation,dissOut,drift,fill,uTime;uniform vec3 cGold,cRose;\n' +
      'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
      'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}\n' +
      '#ifdef MANUAL\nvec4 bilerp(sampler2D s,vec2 uv,vec2 ts){vec2 st=uv/ts-.5;vec2 i=floor(st),f=fract(st);' +
      'vec4 a=texture2D(s,(i+vec2(.5,.5))*ts),b=texture2D(s,(i+vec2(1.5,.5))*ts),c=texture2D(s,(i+vec2(.5,1.5))*ts),d=texture2D(s,(i+vec2(1.5,1.5))*ts);' +
      'return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}\n#endif\n' +
      'void main(){\n#ifdef MANUAL\nvec2 vel=bilerp(uVelocity,vUv,texelSize).xy*texelSize;\n#else\nvec2 vel=texture2D(uVelocity,vUv).xy*texelSize;\n#endif\n' +
      ' vec2 hp=toHeart(vUv);float d=sdHeart(hp);' +
      ' vec2 dr=vec2(0.);if(drift>0.){vec2 g=heartGrad(hp);dr=-vec2(g.x/uHeart.x,g.y)*drift*(.3+clamp(d,0.,.7))*smoothstep(-.09,.0,d);}' +
      ' vec2 coord=vUv-dt*(vel+dr);\n#ifdef MANUAL\nvec4 r=bilerp(uSource,coord,dyeTexelSize);\n#else\nvec4 r=texture2D(uSource,coord);\n#endif\n' +
      ' if(fill>0.){float inside=smoothstep(-.004,-.03,d);float n=vnoise(hp*6.+vec2(uTime*.13,-uTime*.09))*.6+vnoise(hp*14.-uTime*.2)*.4;n=1.-abs(2.*n-1.);n=n*n*n;' +
      ' float side=smoothstep(-.12,.12,hp.x+.09*sin(hp.y*8.+uTime*.7));vec3 c=mix(cGold,cRose,side);' +
      ' r.rgb+=c*fill*dt*inside*(.18+1.6*n);}' +
      ' float diss=dissipation+dissOut*smoothstep(-.01,.025,d);gl_FragColor=r/(1.+diss*dt);}',
    heartForce: HEAD + VARY + HEART +
      'uniform sampler2D uVelocity;uniform float amt,dt,toTex;' +
      'void main(){vec2 v=texture2D(uVelocity,vUv).xy;vec2 hp=toHeart(vUv);float d=sdHeart(hp);vec2 g=heartGrad(hp);' +
      ' float sx=hp.x<0.?-1.:1.;vec2 tang=sx>0.?vec2(-g.y,g.x):vec2(g.y,-g.x);' +
      ' vec2 r=hp-vec2(.25*sx,.72);float rr=dot(r,r);vec2 vort=sx*vec2(-r.y,r.x)/(rr+.03)*exp(-rr/.12);' +
      ' vec2 target=(tang*.16*exp(-d*d/.012)+vort*.045)*toTex;' +
      ' float inside=smoothstep(.06,-.04,d);float k=1.-exp(-(1.2+2.4*inside)*amt*dt);gl_FragColor=vec4(mix(v,target*inside,k),0.,1.);}',
    divergence: HEAD + VARY + 'uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).x,R=texture2D(uVelocity,vR).x,T=texture2D(uVelocity,vT).y,B=texture2D(uVelocity,vB).y;' +
      'vec2 C=texture2D(uVelocity,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;gl_FragColor=vec4(.5*(R-L+T-B),0.,0.,1.);}',
    curl: HEAD + VARY + 'uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).y,R=texture2D(uVelocity,vR).y,T=texture2D(uVelocity,vT).x,B=texture2D(uVelocity,vB).x;gl_FragColor=vec4(.5*(R-L-T+B),0.,0.,1.);}',
    vorticity: HEAD + VARY + 'uniform sampler2D uVelocity,uCurl;uniform float curl,dt;void main(){float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x;' +
      'vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+.0001;f*=curl*C;f.y*=-1.;vec2 v=texture2D(uVelocity,vUv).xy+f*dt;gl_FragColor=vec4(clamp(v,-1000.,1000.),0.,1.);}',
    pressure: HEAD + VARY + 'uniform sampler2D uPressure,uDivergence;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x;' +
      'gl_FragColor=vec4((L+R+B+T-texture2D(uDivergence,vUv).x)*.25,0.,0.,1.);}',
    gradient: HEAD + VARY + 'uniform sampler2D uPressure,uVelocity;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x;' +
      'vec2 v=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);gl_FragColor=vec4(v,0.,1.);}',
    display: HEAD + VARY + HEART +
      'uniform sampler2D uTexture;uniform vec2 dyeTexel,uRes;uniform float uBeat;' +
      'void main(){vec2 hc=vec2(.5,uHeart.z+.55*uHeart.y);vec2 uv=hc+(vUv-hc)/(1.+.022*uBeat);' +
      ' vec3 c=texture2D(uTexture,uv).rgb;vec3 lc=texture2D(uTexture,uv-vec2(dyeTexel.x,0.)).rgb,rc=texture2D(uTexture,uv+vec2(dyeTexel.x,0.)).rgb,' +
      ' tc=texture2D(uTexture,uv+vec2(0.,dyeTexel.y)).rgb,bc=texture2D(uTexture,uv-vec2(0.,dyeTexel.y)).rgb;' +
      ' vec3 n=normalize(vec3(length(rc)-length(lc),length(tc)-length(bc),length(dyeTexel)*1.6));vec3 l=normalize(vec3(-.45,.6,1.));' +
      ' float diff=clamp(dot(n,l)+.5,.62,1.12);float spec=pow(max(dot(reflect(-l,n),vec3(0.,0.,1.)),0.),28.);' +
      ' vec3 ink=1.-exp(-c*diff*1.45);ink+=spec*.4*clamp(length(c)*1.6,0.,1.)*vec3(1.,.9,.74);' +
      ' vec2 q=(vUv-vec2(.5,.52))*vec2(uRes.x/uRes.y,1.);' +
      ' vec3 bg=mix(vec3(.13,.062,.118),vec3(.027,.016,.039),smoothstep(.0,.85,length(q)*1.25));' +
      ' float a=clamp(max(max(ink.r,ink.g),ink.b)*1.25,0.,1.);vec3 col=ink+bg*(1.-a);' +
      ' col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;gl_FragColor=vec4(col,1.);}'
  };

  function compile(type, src, defs) {
    var s = gl.createShader(type); gl.shaderSource(s, (defs || '') + src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var VS = compile(gl.VERTEX_SHADER, SRC.vert);
  function program(name, defs) {
    var p = gl.createProgram();
    gl.attachShader(p, VS); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, SRC[name], defs));
    gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p: p, u: u, bind: function () { gl.useProgram(p); return u; } };
  }
  var MANUAL = ctx.linear ? '' : '#define MANUAL\n';
  var prg = {};
  ['copy', 'clear', 'splat', 'heartForce', 'divergence', 'curl', 'vorticity', 'pressure', 'gradient', 'display'].forEach(function (k) { prg[k] = program(k); });
  prg.advect = program('advect', MANUAL);

  var quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  var idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
  function blit(t) {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  /* ---------- framebuffers ---------- */
  function fbo(w, h, f, filter) {
    gl.activeTexture(gl.TEXTURE0);
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, ctx.type, null);
    var b = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, b);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex: t, fbo: b, w: w, h: h, tx: 1 / w, ty: 1 / h,
      attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, t); return id; },
      free: function () { gl.deleteTexture(t); gl.deleteFramebuffer(b); } };
  }
  function dbl(w, h, f, filter) {
    var a = fbo(w, h, f, filter), b = fbo(w, h, f, filter);
    return { w: w, h: h, tx: 1 / w, ty: 1 / h, read: a, write: b, swap: function () { var t = this.read; this.read = this.write; this.write = t; } };
  }
  function regrow(old, w, h, f, filter) {      // keep what is in the water when the screen turns
    var n = fbo(w, h, f, filter); var u = prg.copy.bind();
    gl.uniform1i(u.uTexture, old.attach(0)); gl.uniform2f(u.texelSize, 1 / w, 1 / h); blit(n); old.free(); return n;
  }
  function regrowDbl(d, w, h, f, filter) {
    if (d.w === w && d.h === h) return d;
    d.read = regrow(d.read, w, h, f, filter); d.write.free(); d.write = fbo(w, h, f, filter);
    d.w = w; d.h = h; d.tx = 1 / w; d.ty = 1 / h; return d;
  }
  function res(r) {
    var a = gl.drawingBufferWidth / gl.drawingBufferHeight; if (a < 1) a = 1 / a;
    var lo = Math.round(r), hi = Math.round(r * a);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? [hi, lo] : [lo, hi];
  }
  var dye, vel, divg, curlF, pres;
  function initFBOs() {
    var s = res(P.SIM), d = res(P.DYE), lin = ctx.linear ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);
    if (!dye) dye = dbl(d[0], d[1], ctx.rgba, lin); else dye = regrowDbl(dye, d[0], d[1], ctx.rgba, lin);
    if (!vel) vel = dbl(s[0], s[1], ctx.rg, lin); else vel = regrowDbl(vel, s[0], s[1], ctx.rg, lin);
    if (divg) { divg.free(); curlF.free(); pres.read.free(); pres.write.free(); }
    divg = fbo(s[0], s[1], ctx.r, gl.NEAREST); curlF = fbo(s[0], s[1], ctx.r, gl.NEAREST); pres = dbl(s[0], s[1], ctx.r, gl.NEAREST);
  }

  /* ---------- the heart in the water ---------- */
  var W = 1, H = 1, ASP = 1, HSC = 0.4, TIP = 0.3;
  function sdHeart(x, y) {
    x = Math.abs(x);
    if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - 0.35355;
    var m = 0.5 * Math.max(x + y, 0);
    return Math.sqrt(Math.min(x * x + (y - 1) * (y - 1), (x - m) * (x - m) + (y - m) * (y - m))) * Math.sign(x - y);
  }
  // the right half of the outline, tip to cleft, evenly spaced, a little inside the edge
  var OUT = 240, outX = new Float32Array(OUT), outY = new Float32Array(OUT);
  (function () {
    var K = 600, xs = [], ys = [], len = [0];
    for (var k = 0; k <= K; k++) {
      var a = -Math.PI / 2 + Math.PI * k / K, dx = Math.cos(a), dy = Math.sin(a), lo = 0, hi = 1.5;
      for (var it = 0; it < 30; it++) { var m = (lo + hi) / 2; if (sdHeart(dx * m, 0.5 + dy * m) < 0) lo = m; else hi = m; }
      xs.push(dx * lo * 0.93); ys.push(0.5 + dy * lo * 0.93);
      if (k) len.push(len[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]));
    }
    for (var j = 0, q = 0; j < OUT; j++) {
      var want = len[K] * j / (OUT - 1);
      while (q < K - 1 && len[q + 1] < want) q++;
      var f = (want - len[q]) / Math.max(1e-6, len[q + 1] - len[q]);
      outX[j] = xs[q] + (xs[q + 1] - xs[q]) * f; outY[j] = ys[q] + (ys[q + 1] - ys[q]) * f;
    }
  })();
  function heartUV(hx, hy) { return [0.5 + hx * HSC / ASP, TIP + hy * HSC]; }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth || innerWidth; H = stage.clientHeight || innerHeight;
    var cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    ASP = W / H; HSC = Math.min(0.38, 0.62 * ASP); TIP = 0.49 - 0.56 * HSC;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; initFBOs(); }
  }

  /* ---------- putting ink and motion in the water ---------- */
  function splat(x, y, dx, dy, c, rMul) {
    var u = prg.splat.bind();
    gl.uniform1i(u.uTarget, vel.read.attach(0));
    gl.uniform1f(u.aspectRatio, ASP); gl.uniform2f(u.point, x, y); gl.uniform3f(u.color, dx, dy, 0);
    var r = P.RADIUS * (rMul || 1); if (ASP > 1) r *= ASP;
    gl.uniform1f(u.radius, r); gl.uniform2f(u.texelSize, vel.tx, vel.ty);
    blit(vel.write); vel.swap();
    if (c) {
      gl.uniform1i(u.uTarget, dye.read.attach(0)); gl.uniform3f(u.color, c[0], c[1], c[2]); gl.uniform2f(u.texelSize, dye.tx, dye.ty);
      blit(dye.write); dye.swap();
    }
  }
  function tint(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function force(d, isX) {           // a movement across the screen, as a push in the water
    if (isX) { if (ASP < 1) d *= ASP; } else if (ASP > 1) d /= ASP;
    return d * P.FORCE;
  }

  /* ---------- one step of the water ---------- */
  var settle = 0, fillAmt = 0, clock = 0;
  function step(dt) {
    gl.disable(gl.BLEND);
    var u = prg.curl.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); blit(curlF);

    u = prg.vorticity.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); gl.uniform1i(u.uCurl, curlF.attach(1));
    gl.uniform1f(u.curl, P.CURL * (1 - 0.85 * settle)); gl.uniform1f(u.dt, dt); blit(vel.write); vel.swap();

    if (settle > 0.002) {
      u = prg.heartForce.bind();
      gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0));
      gl.uniform3f(u.uHeart, ASP, HSC, TIP); gl.uniform1f(u.amt, settle); gl.uniform1f(u.dt, dt); gl.uniform1f(u.toTex, HSC * vel.h);
      blit(vel.write); vel.swap();
    }

    u = prg.divergence.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uVelocity, vel.read.attach(0)); blit(divg);

    u = prg.clear.bind();
    gl.uniform1i(u.uTexture, pres.read.attach(0)); gl.uniform1f(u.value, P.PRESSURE); blit(pres.write); pres.swap();

    u = prg.pressure.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uDivergence, divg.attach(0));
    for (var i = 0; i < P.ITER; i++) { gl.uniform1i(u.uPressure, pres.read.attach(1)); blit(pres.write); pres.swap(); }

    u = prg.gradient.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform1i(u.uPressure, pres.read.attach(0)); gl.uniform1i(u.uVelocity, vel.read.attach(1));
    blit(vel.write); vel.swap();

    u = prg.advect.bind();
    gl.uniform2f(u.texelSize, vel.tx, vel.ty); gl.uniform2f(u.dyeTexelSize, vel.tx, vel.ty);
    gl.uniform3f(u.uHeart, ASP, HSC, TIP);
    var vid = vel.read.attach(0); gl.uniform1i(u.uVelocity, vid); gl.uniform1i(u.uSource, vid);
    gl.uniform1f(u.dt, dt); gl.uniform1f(u.dissipation, P.VEL_DISS + 0.8 * settle); gl.uniform1f(u.dissOut, 0); gl.uniform1f(u.drift, 0); gl.uniform1f(u.fill, 0);
    blit(vel.write); vel.swap();

    gl.uniform2f(u.dyeTexelSize, dye.tx, dye.ty);
    gl.uniform1i(u.uVelocity, vel.read.attach(0)); gl.uniform1i(u.uSource, dye.read.attach(1));
    gl.uniform1f(u.dissipation, P.DYE_DISS * (1 - settle) + 0.42 * settle); gl.uniform1f(u.dissOut, 1.6 * settle); gl.uniform1f(u.drift, 0.09 * settle);
    gl.uniform1f(u.fill, fillAmt); gl.uniform1f(u.uTime, clock); gl.uniform3f(u.cGold, GOLD[0], GOLD[1], GOLD[2]); gl.uniform3f(u.cRose, ROSE[0], ROSE[1], ROSE[2]);
    blit(dye.write); dye.swap();
  }
  function render(beat) {
    var u = prg.display.bind();
    gl.uniform2f(u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform2f(u.dyeTexel, dye.tx, dye.ty); gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(u.uHeart, ASP, HSC, TIP); gl.uniform1f(u.uBeat, beat);
    gl.uniform1i(u.uTexture, dye.read.attach(0)); blit(null);
  }

  /* ---------- the story ---------- */
  var phase = 'intro', tPhase = 0, idle = 0, stir = 0, formedOnce = false, colorTurn = 0, ghostT = 1.2, ghostN = 0, ghosts = [];
  var pointers = {};

  var capShown = capEl.textContent, capTimer = 0;
  function say(text) {
    if (text === capShown) return;
    capShown = text; capEl.classList.remove('on'); clearTimeout(capTimer);
    capTimer = setTimeout(function () { capEl.textContent = text; capEl.classList.add('on'); }, 650);
  }

  function opening() {                  // the first drops, so the water is never empty
    var drops = [[0.24, 0.62, GOLD, 1], [0.3, 0.38, GOLD, 1], [0.76, 0.6, ROSE, -1], [0.7, 0.36, ROSE, -1]];
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      splat(d[0], d[1], d[3] * 520, (Math.random() - 0.5) * 300, tint(d[2], 0.55), 3);
    }
  }
  function newGhost() {
    var left = ghostN++ % 2 === 0, y0 = 0.3 + Math.random() * 0.4, y1 = 0.3 + Math.random() * 0.4;
    ghosts.push({
      t: 0, dur: 1.5 + Math.random() * 0.5, c: left ? GOLD : ROSE,
      p: [left ? 0.1 : 0.9, y0, left ? 0.35 : 0.65, y0 + (Math.random() - 0.5) * 0.5, left ? 0.55 : 0.45, y1 + (Math.random() - 0.5) * 0.4, left ? 0.7 : 0.3, y1],
      lx: null, ly: null
    });
  }
  function bez(p, t) {
    var u = 1 - t;
    return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
            u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]];
  }
  function runGhosts(dt) {
    for (var i = ghosts.length - 1; i >= 0; i--) {
      var g = ghosts[i]; g.t += dt;
      var k = Math.min(1, g.t / g.dur), e = k * k * (3 - 2 * k), q = bez(g.p, e);
      if (g.lx !== null) splat(q[0], q[1], force(q[0] - g.lx, true) * 0.8, force(q[1] - g.ly, false) * 0.8, tint(g.c, 0.07 * Math.sin(Math.PI * k) + 0.01));
      g.lx = q[0]; g.ly = q[1];
      if (k >= 1) ghosts.splice(i, 1);
    }
  }

  // two streams of ink trace the outline, gold on the left and rose on the right, then keep it fed
  var em = 0, emLast = -1;
  function runEmitters(dt) {
    var first = true, speed = 1 / 4.4;
    if (tPhase < 0.9 || tPhase > 5.3) return;
    em += dt * speed; if (em > 1) { em -= 1; emLast = -1; }
    var j = Math.min(OUT - 1, Math.floor(em * (OUT - 1))), j2 = Math.min(OUT - 1, j + 3);
    var amt = (first ? 3.2 : 1.1) * dt * settle;
    for (var side = -1; side <= 1; side += 2) {
      var a = heartUV(side * outX[j], outY[j]), b = heartUV(side * outX[j2], outY[j2]);
      var dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) + 1e-6;
      splat(a[0], a[1], dx / dl * 30, dy / dl * 30, tint(side < 0 ? GOLD : ROSE, amt), 2.6);
    }
  }

  function startSettle() {
    phase = 'settle'; tPhase = 0; em = 0; ghosts.length = 0;
    say('ثمّ يهدأ الماء…');
  }
  function stirUp() {
    var wasHeart = phase === 'settle' && tPhase > 5;
    phase = 'play'; tPhase = 0;
    if (wasHeart) formedOnce = true;
    say(wasHeart || formedOnce ? 'حرّكيه كما تشائين… سيعود.' : 'امزجيهما كما تشائين.');
  }

  var beat = 0;
  function story(dt) {
    tPhase += dt;
    var down = 0; for (var id in pointers) down++;
    idle = down ? 0 : idle + dt;
    if (phase === 'intro') {
      if (!REDUCED) { ghostT -= dt; if (ghostT <= 0) { newGhost(); ghostT = 2.3; } }
      if (tPhase > (REDUCED ? 3 : 15)) startSettle();
    } else if (phase === 'play') {
      if (!down && ((idle > 2.2 && (stir > 1.4 || formedOnce)) || idle > 4.5)) startSettle();
    } else if (phase === 'settle') {
      if (tPhase > 5.6) say('وصار الحبرانِ قلبًا واحدًا.');
    }
    var want = phase === 'settle' ? 1 : 0;
    settle += (want - settle) * (1 - Math.exp(-dt * (want ? 0.9 : 6)));
    var fillWant = phase === 'settle' ? 0.34 * Math.min(1, Math.max(0, (tPhase - 2.2) / 3)) : 0;
    fillAmt += (fillWant - fillAmt) * (1 - Math.exp(-dt * (fillWant > fillAmt ? 2 : 8)));
    clock += dt;
    var formed = phase === 'settle' && tPhase > 7;
    endEl.classList.toggle('on', formed);
    if (formed && !REDUCED) {
      var u = (tPhase - 7) % 1.2, a = (u - 0.08) / 0.06, b = (u - 0.34) / 0.07;
      beat = Math.exp(-a * a) + 0.55 * Math.exp(-b * b);
    } else beat *= Math.exp(-dt * 6);
    runGhosts(dt);
    if (phase === 'settle') runEmitters(dt);
  }

  /* ---------- fingers ---------- */
  function uvOf(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]; }
  on(canvas, 'pointerdown', function (e) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var q = uvOf(e), c = colorTurn++ % 2 ? ROSE : GOLD;
    pointers[e.pointerId] = { x: q[0], y: q[1], px: q[0], py: q[1], moved: false, c: c };
    hintEl.classList.remove('on');
    if (phase !== 'play') stirUp();
    splat(q[0], q[1], 0, 0, tint(c, 0.5), 2.6);   // a drop where the finger lands
  });
  on(canvas, 'pointermove', function (e) {
    var p = pointers[e.pointerId]; if (!p) return;
    var q = uvOf(e); p.x = q[0]; p.y = q[1]; p.moved = true;
  });
  function lift(e) { delete pointers[e.pointerId]; }
  on(canvas, 'pointerup', lift); on(canvas, 'pointercancel', lift);
  on(window, 'blur', function () { pointers = {}; });
  function runPointers() {
    for (var id in pointers) {
      var p = pointers[id]; if (!p.moved) continue;
      p.moved = false;
      var dx = p.x - p.px, dy = p.y - p.py, dist = Math.hypot(dx * ASP, dy);
      stir += dist;
      splat(p.x, p.y, force(dx, true), force(dy, false), tint(p.c, 0.045 + Math.min(0.12, dist * 2.2)));
      p.px = p.x; p.py = p.y;
    }
  }

  /* ---------- loop ---------- */
  resize(); opening();
  on(window, 'resize', resize);
  var last = performance.now();
  function frame(now) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    var raw = (now - last) / 1000; last = now;
    if (raw <= 0) return;
    var dt = Math.min(raw, 1 / 30);
    resize(); runPointers(); story(dt); step(dt); render(beat);
  }
  raf = requestAnimationFrame(frame);
  return function () {
    dead = true; cancelAnimationFrame(raf); clearTimeout(capTimer);
    offs.forEach(function (f) { f(); });
    var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  };
}
