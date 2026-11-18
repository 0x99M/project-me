/* eslint-disable */
// The /hearts-v3 engine. WebGL draws the galaxy of hearts and the threads; a 2D canvas on top draws M and S.
// startHeartsV3(root) wires everything up and returns a cleanup that stops the frame loop, timers and listeners.
export function startHeartsV3(root){
  "use strict";
  var dead=false, paused=false, raf=0, offs=[], timers=[];
  function on(el,type,fn,opt){ el.addEventListener(type,fn,opt); offs.push(function(){ el.removeEventListener(type,fn,opt); }); }
  function later(fn,ms){ timers.push(setTimeout(fn,ms)); }
  var $=function(id){ return root.querySelector("#"+id); };
  var glc=$("gl"), ov=$("ov"), o=ov.getContext("2d");
  var elCount=$("count"), elNum=$("num"), elEnd=$("end"), elEndPos=$("endpos"), elReplay=$("replay");
  var reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SCRIPT=(getComputedStyle(root).getPropertyValue("--font-hv3-script").trim()||'"Great Vibes"')+', "Snell Roundhand", cursive';

  var TAU=Math.PI*2;
  function clamp(x,a,b){ return x<a?a:x>b?b:x; }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function ss(a,b,x){ var t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
  function eio(t){ return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
  function eSine(t){ return -(Math.cos(Math.PI*t)-1)/2; }
  function eOut(t){ return 1-Math.pow(1-t,3); }
  function bump(x,w){ return x<0||x>w?0:Math.sin(Math.PI*x/w); }
  function beatShape(f){ return bump(f,.13)+.55*bump(f-.2,.13); }
  function frac(x){ return x-Math.floor(x); }
  function vib(p){ try{ navigator.vibrate&&navigator.vibrate(p); }catch(e){} }
  function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
  function sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
  function scl(a,s){ return [a[0]*s,a[1]*s,a[2]*s]; }
  function mix3(a,b,t){ return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]; }
  function norm(a){ var l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; }
  function cross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
  function rotY(a,ang){ var c=Math.cos(ang), s=Math.sin(ang); return [c*a[0]+s*a[2],a[1],-s*a[0]+c*a[2]]; }
  function bez(p0,p1,p2,p3,t){ var u=1-t; return add(add(scl(p0,u*u*u),scl(p1,3*u*u*t)),add(scl(p2,3*u*t*t),scl(p3,t*t*t))); }
  function rng(seed){ return function(){ seed=(seed+0x6D2B79F5)|0; var t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

  /* ---------- the heart path: half of it is the search, the other half is the way home ---------- */
  var K=22;
  function heartXY(t){ var s=Math.sin(t); return [16*s*s*s,13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t)]; }
  function makePath(t0,t1,n,wig,lat,seed){
    var bx=new Float64Array(n), bz=new Float64Array(n), P=new Float64Array(n*3), cum=new Float64Array(n), i;
    for(i=0;i<n;i++){ var h=heartXY(t0+(t1-t0)*i/(n-1)); bx[i]=h[0]*K; bz[i]=-(h[1]+2.5)*K; }
    for(i=0;i<n;i++){
      var a=Math.max(0,i-1), b=Math.min(n-1,i+1), tx=bx[b]-bx[a], tz=bz[b]-bz[a], tl=Math.hypot(tx,tz)||1, f=i/(n-1), env=Math.sin(Math.PI*f);
      var l=lat*env*(Math.sin(f*TAU*5.3+seed)+.5*Math.sin(f*TAU*12.1+seed*2));
      var y=wig*env*(Math.sin(f*TAU*4.1+seed*3)+.45*Math.sin(f*TAU*9.7+seed));
      P[i*3]=bx[i]-tz/tl*l; P[i*3+1]=y; P[i*3+2]=bz[i]+tx/tl*l;
      if(i) cum[i]=cum[i-1]+Math.hypot(P[i*3]-P[i*3-3],P[i*3+1]-P[i*3-2],P[i*3+2]-P[i*3-1]);
    }
    return {P:P,cum:cum,n:n,len:cum[n-1]};
  }
  function at(path,L){
    var c=path.cum, lo=0, hi=path.n-1; L=clamp(L,0,path.len);
    while(hi-lo>1){ var m=(lo+hi)>>1; if(c[m]<=L) lo=m; else hi=m; }
    var f=(L-c[lo])/((c[hi]-c[lo])||1), P=path.P;
    return [lerp(P[lo*3],P[hi*3],f),lerp(P[lo*3+1],P[hi*3+1],f),lerp(P[lo*3+2],P[hi*3+2],f)];
  }
  var LP=makePath(Math.PI,TAU,3200,8,18,1.3), RP=makePath(0,Math.PI,3200,3,6,4.1);
  var M=[0,0,LP.P[2]], S=[0,0,RP.P[2]], C=[0,0,0], Ll=LP.len;

  /* ---------- the galaxy ---------- */
  var R=rng(20270313);
  function gauss(){ var u=1-R(), v=R(); return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v); }
  var smallScreen=Math.min(screen.width,screen.height)<700;
  var NH=smallScreen?26000:46000, ND=Math.round(NH*.8), N=NH+ND;
  var GAL=new Float32Array(N*8);
  var ARM=[[1,.22,.40],[1,.40,.56],[1,.58,.72],[.78,.10,.32],[.92,.22,.58],[1,.32,.36]], CORE=[[1,.72,.78],[1,.84,.82],[1,.6,.7]];
  for(var i=0;i<N;i++){
    var dust=i>=NH, x=0, y=0, z=0;
    for(var tries=0;tries<20;tries++){
      var kind=R();
      if(kind<.13){ x=gauss()*110; z=gauss()*110; y=gauss()*48; }
      else if(kind<.78){
        var rr=Math.min(1150,70+(-Math.log(1-R()*.985))*290), arm=Math.floor(R()*3), th=arm*TAU/3+Math.log(rr/70)*2.05+gauss()*.2*(1+rr/1000);
        x=Math.cos(th)*rr+gauss()*15; z=Math.sin(th)*rr+gauss()*15; y=gauss()*(9+20*Math.exp(-rr/280));
      } else { var r2=Math.sqrt(R())*1180, t2=R()*TAU; x=Math.cos(t2)*r2; z=Math.sin(t2)*r2; y=gauss()*13; }
      if(Math.hypot(x-S[0],y-S[1],z-S[2])>9&&Math.hypot(x-M[0],y-M[1],z-M[2])>7) break;
    }
    var rad=Math.hypot(x,z), core=Math.exp(-rad/230);
    var col=R()<core*.9?CORE[Math.floor(R()*CORE.length)]:ARM[Math.floor(R()*ARM.length)];
    var br=(dust?.16+.22*R():.3+.5*R())*(.8+.9*core);
    var size=dust?.35+.3*R():(R()<.03?3+R()*1.6:1+R()*1.3);
    var k8=i*8; GAL[k8]=x; GAL[k8+1]=y; GAL[k8+2]=z; GAL[k8+3]=col[0]*br; GAL[k8+4]=col[1]*br; GAL[k8+5]=col[2]*br; GAL[k8+6]=size; GAL[k8+7]=R();
  }

  // thread beads: xyz + u (how far along the thread, 0..1)
  var NLOOP=300;
  function threadBuffer(path,loop){
    var n=path.n+(loop?NLOOP:0), b=new Float32Array(n*4), uEnd=loop?path.n/n:1, j;
    for(j=0;j<path.n;j++){ b[j*4]=path.P[j*3]; b[j*4+1]=path.P[j*3+1]; b[j*4+2]=path.P[j*3+2]; b[j*4+3]=path.cum[j]/path.len*uEnd; }
    if(loop) for(j=0;j<NLOOP;j++){
      var a=j/(NLOOP-1), ang=a*TAU*1.35+2.2, r=3*ss(0,.25,a), q=(path.n+j)*4;
      b[q]=S[0]+r*Math.cos(ang); b[q+1]=S[1]+.5*Math.sin(ang*2)*r/3; b[q+2]=S[2]+r*Math.sin(ang); b[q+3]=uEnd+(1-uEnd)*a;
    }
    return {data:b,n:n,uEnd:uEnd};
  }
  // Each bead becomes two vertices (left/right edge); the shader spreads them a few pixels apart, facing the camera.
  function ribbon(tb){
    var n=tb.n, d=tb.data, out=new Float32Array(n*16), us=new Float32Array(n);
    for(var i=0;i<n;i++){
      var j=i<n-1?i+1:i-1, nx=d[j*4], ny=d[j*4+1], nz=d[j*4+2];
      if(i===n-1){ nx=2*d[i*4]-nx; ny=2*d[i*4+1]-ny; nz=2*d[i*4+2]-nz; }
      us[i]=d[i*4+3];
      for(var e=0;e<2;e++){ var q=(i*2+e)*8; out[q]=d[i*4]; out[q+1]=d[i*4+1]; out[q+2]=d[i*4+2]; out[q+3]=d[i*4+3]; out[q+4]=nx; out[q+5]=ny; out[q+6]=nz; out[q+7]=e?1:-1; }
    }
    tb.rib=out; tb.us=us; return tb;
  }
  function countUpTo(tb,prog){ var us=tb.us, lo=0, hi=tb.n; while(lo<hi){ var m=(lo+hi)>>1; if(us[m]<=prog) lo=m+1; else hi=m; } return lo; }
  var TL=ribbon(threadBuffer(LP,true)), TR=ribbon(threadBuffer(RP,false));

  /* ---------- WebGL ---------- */
  var gl=glc.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:"high-performance"});
  var GV="precision highp float;attribute vec3 aPos;attribute vec4 aCol;attribute float aPh;"+
    "uniform mat4 uVP;uniform float uFocal,uTime,uTipOn,uAlpha,uGain,uWave,uWaveA,uMaxPx,uDPR;uniform vec3 uTip,uWaveO;"+
    "varying vec3 vCol;varying float vA,vPx;"+
    "void main(){vec4 c=uVP*vec4(aPos,1.);gl_Position=c;float w=c.w;"+
    "if(w<.05){gl_PointSize=0.;vA=0.;vPx=0.;vCol=vec3(0.);return;}"+
    "float px=aCol.a*uFocal/w;vec3 d=aPos-uTip;float fl=uTipOn*exp(-dot(d,d)/130.);"+
    "float tw=.78+.22*sin(uTime*1.7+aPh*6.2831);float wd=length(aPos-uWaveO)-uWave;float wv=uWaveA*exp(-wd*wd/2500.);"+
    "float a=uAlpha*uGain*tw*(1.+1.4*fl+1.2*wv);px*=1.+.35*fl;float mn=1.3*uDPR;if(px<mn){a*=sqrt(px/mn);px=mn;}"+
    "a*=1.-smoothstep(uMaxPx*.55,uMaxPx,px);a*=smoothstep(.6,4.,w);"+
    "gl_PointSize=min(px,uMaxPx);vPx=gl_PointSize;vCol=mix(aCol.rgb,vec3(1.,.8,.84),clamp(fl*.6+wv*.35,0.,1.));vA=a;}";
  var GF="precision mediump float;varying vec3 vCol;varying float vA,vPx;"+
    "float d2(vec2 v){return dot(v,v);}"+
    "float sdH(vec2 p){p.x=abs(p.x);if(p.y+p.x>1.)return sqrt(d2(p-vec2(.25,.75)))-.35355;return sqrt(min(d2(p-vec2(0.,1.)),d2(p-.5*max(p.x+p.y,0.))))*sign(p.x-p.y);}"+
    "void main(){vec2 q=gl_PointCoord*2.-1.;q.y=-q.y;float a;"+
    "if(vPx<6.){a=max(0.,1.-dot(q,q));a*=a;}else{vec2 p=q*.85+vec2(0.,.55);float d=sdH(p);a=clamp(.5-d*vPx/1.7,0.,1.);a+=.3*exp(-max(d,0.)*10.)*(1.-a);}"+
    "gl_FragColor=vec4(vCol*a*vA,0.);}";
  var TV="precision highp float;attribute vec4 aP;attribute vec4 aN;uniform mat4 uVP;uniform vec2 uRes;"+
    "uniform float uFocal,uProg,uSize,uMinPx,uMaxPx,uAlpha,uTime,uFlow,uDPR,uHeadK;uniform vec3 uCol,uHead;"+
    "varying vec3 vCol;varying float vA,vS;"+
    "void main(){vec4 c=uVP*vec4(aP.xyz,1.);vec4 n=uVP*vec4(aN.xyz,1.);"+
    "vec2 sc=c.xy/max(abs(c.w),1e-4)*uRes*.5,sn=n.xy/max(abs(n.w),1e-4)*uRes*.5;vec2 dr=sn-sc;dr=length(dr)>1e-4?normalize(dr):vec2(1.,0.);"+
    "float px=clamp(uSize*uFocal/max(c.w,.05),uMinPx*uDPR,uMaxPx*uDPR);float h=exp(-max(uProg-aP.w,0.)*uHeadK);px*=1.+h*.8;"+
    "gl_Position=vec4(c.xy+vec2(-dr.y,dr.x)*aN.w*px*.5/(uRes*.5)*c.w,c.z,c.w);"+
    "float fl=1.+uFlow*.9*pow(.5+.5*sin((aP.w*7.-uTime*.55)*6.2831),6.);vS=aN.w;vCol=mix(uCol,uHead,h);vA=uAlpha*(1.+h*1.5)*fl*smoothstep(.2,1.5,c.w);}";
  var TF="precision mediump float;varying vec3 vCol;varying float vA,vS;uniform float uEdge;void main(){float a=exp(-vS*vS*uEdge);gl_FragColor=vec4(vCol*a*vA,0.);}";

  function prog(vs,fs){
    function sh(type,src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u={}, n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS); for(var i=0;i<n;i++){ var nm=gl.getActiveUniform(p,i).name; u[nm]=gl.getUniformLocation(p,nm); }
    var at={}, na=gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES); for(i=0;i<na;i++){ var an=gl.getActiveAttrib(p,i).name; at[an]=gl.getAttribLocation(p,an); }
    return {p:p,u:u,a:at};
  }
  var PG=null, PT=null, bufG=null, bufL=null, bufR=null, MAXPT=64;
  if(gl){
    try{
      PG=prog(GV,GF); PT=prog(TV,TF);
      bufG=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,bufG); gl.bufferData(gl.ARRAY_BUFFER,GAL,gl.STATIC_DRAW);
      bufL=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,bufL); gl.bufferData(gl.ARRAY_BUFFER,TL.rib,gl.STATIC_DRAW);
      bufR=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,bufR); gl.bufferData(gl.ARRAY_BUFFER,TR.rib,gl.STATIC_DRAW);
      MAXPT=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]||64;
    }catch(e){ console.error(e); gl=null; }
  }

  /* ---------- camera ---------- */
  function persp(fovy,asp,n,f){ var t=1/Math.tan(fovy/2), nf=1/(n-f); return [t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; }
  function lookAt(e,c,u){
    var zx=e[0]-c[0], zy=e[1]-c[1], zz=e[2]-c[2], l=Math.hypot(zx,zy,zz)||1; zx/=l; zy/=l; zz/=l;
    var xx=u[1]*zz-u[2]*zy, xy=u[2]*zx-u[0]*zz, xz=u[0]*zy-u[1]*zx; l=Math.hypot(xx,xy,xz)||1; xx/=l; xy/=l; xz/=l;
    var yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*e[0]+xy*e[1]+xz*e[2]),-(yx*e[0]+yy*e[1]+yz*e[2]),-(zx*e[0]+zy*e[1]+zz*e[2]),1];
  }
  function mul(a,b){ var r=new Float32Array(16); for(var i=0;i<4;i++) for(var j=0;j<4;j++){ var s=0; for(var k=0;k<4;k++) s+=a[k*4+j]*b[i*4+k]; r[i*4+j]=s; } return r; }

  var W=1,H=1,DPR=1,dFull=4000,dOver=1600,phi0=0,AT={};
  var T=-1, time=0, last=0, VP=null, FOCAL=1, camNow=null;
  var ptr={x:0,y:0,nx:0,ny:0,down:false,moved:0}, drag={yaw:0,pitch:0}, wave={t0:-99,o:[0,0,0]}, tapPulse=-99, vibFound=false;

  var DUR={out:6.5,hold:1.2,dive:2.8,flight:11,found:1.6,rise:6};
  (function(){ var t=0; ["out","hold","dive","flight","found","rise"].forEach(function(k){ AT[k]=t; t+=DUR[k]; }); AT.final=t; })();

  function resize(){
    DPR=Math.min(2,window.devicePixelRatio||1); W=window.innerWidth; H=window.innerHeight;
    glc.width=ov.width=Math.round(W*DPR); glc.height=ov.height=Math.round(H*DPR);
    var asp=W/H, th=Math.tan(55*Math.PI/360);
    dFull=560/(th*Math.min(asp,1.25));
    dOver=Math.max(820/(2*th*asp),1150/(2*th))*1.02;
  }

  function tipL(u){ var b=eSine(u); return Ll*(b+.03*Math.sin(6*Math.PI*b)); }
  function tangentAt(L){ return norm(sub(at(LP,L+4),at(LP,L-4))); }
  function chase(L){
    var e=[0,0,0], t=[0,0,0], k;
    for(k=-2;k<=2;k++){ e=add(e,at(LP,L-24+k*5)); t=add(t,at(LP,L+34+k*6)); }
    e=scl(e,.2); t=scl(t,.2);
    var f=norm(sub(t,e)), side=norm(cross(f,[0,1,0]));
    var h0=tangentAt(L-6), h1=tangentAt(L+40), dh=Math.atan2(h1[0],h1[2])-Math.atan2(h0[0],h0[2]);
    if(dh>Math.PI) dh-=TAU; if(dh<-Math.PI) dh+=TAU;
    var roll=clamp(-dh*.9,-.42,.42);
    return {eye:add(add(e,[0,8,0]),scl(side,6)),target:add(t,[0,-1,0]),up:norm(add(scl([0,1,0],Math.cos(roll)),scl(side,Math.sin(roll)))),fov:52};
  }
  function portrait(phi,r,h){ return {eye:add(S,[Math.sin(phi)*r,h,Math.cos(phi)*r]),target:add(S,[0,.3,0]),up:[0,1,0],fov:48}; }
  function mixPose(a,b,t){ return {eye:mix3(a.eye,b.eye,t),target:mix3(a.target,b.target,t),up:norm(mix3(a.up,b.up,t)),fov:lerp(a.fov,b.fov,t)}; }
  (function(){ var tg=tangentAt(Ll-10); phi0=Math.atan2(-tg[0],-tg[2]); })();
  var OUTDIR=norm([0,.85,1]);
  function outPose(u){
    var tg=mix3(M,C,ss(.2,.9,u)), d=Math.exp(lerp(Math.log(6.7),Math.log(dFull),eio(u)));
    return {eye:add(tg,scl(rotY(OUTDIR,.6*eio(u)),d)),target:tg,up:[0,1,0],fov:50};
  }
  function holdPose(lt){ var p=outPose(1); p.eye=add(C,rotY(sub(p.eye,C),.05*lt)); return p; }
  function overEye(){ return [0,dOver,dOver*.22]; }

  function camAt(tt){
    if(T<0){ var sw=Math.sin(time*.4)*.35+ptr.nx*.9; return {eye:add(M,add(scl(OUTDIR,6.7),[sw,-ptr.ny*.5,0])),target:add(M,[0,.1,0]),up:[0,1,0],fov:50}; }
    var u;
    if(tt<AT.hold) return outPose(tt/DUR.out);
    if(tt<AT.dive) return holdPose(tt-AT.hold);
    if(tt<AT.flight){
      u=eio((tt-AT.dive)/DUR.dive);
      var h=holdPose(DUR.hold), c0=chase(0), back=norm(sub(c0.eye,c0.target));
      var e=bez(h.eye,mix3(h.eye,add(M,[0,dFull*.22,dFull*.18]),.55),add(add(c0.eye,[0,70,0]),scl(back,90)),c0.eye,u);
      return {eye:e,target:mix3(h.target,c0.target,eio(ss(.05,.85,u))),up:norm(mix3([0,1,0],c0.up,ss(.6,1,u))),fov:lerp(50,c0.fov,u)};
    }
    if(tt<AT.found){
      u=(tt-AT.flight)/DUR.flight;
      var cp=chase(tipL(u)), sp=(tipL(Math.min(1,u+.004))-tipL(Math.max(0,u-.004)))/(.008*DUR.flight);
      cp.fov=52+17*clamp(sp/190,0,1);
      return mixPose(cp,portrait(phi0,15,4.5),eio(ss(.84,1,u)));
    }
    if(tt<AT.rise){
      u=eio((tt-AT.found)/DUR.found); var dphi=-phi0; if(dphi>Math.PI) dphi-=TAU; if(dphi<-Math.PI) dphi+=TAU;
      return portrait(phi0+dphi*u,lerp(15,18,u),lerp(4.5,6,u));
    }
    if(tt<AT.final){
      u=(tt-AT.rise)/DUR.rise; var k=eio(u), p0=portrait(0,18,6).eye, p3=overEye();
      return {eye:bez(p0,add(p0,[0,60,70]),add(p3,[0,-dOver*.4,dOver*.45]),p3,k),target:mix3(S,C,eio(ss(0,.85,u))),up:norm(mix3([0,1,0],[0,0,-1],ss(.1,.7,u))),fov:48};
    }
    var yaw=.06*Math.sin((tt-AT.final)*.21)+drag.yaw, oe=overEye();
    oe=[oe[0],oe[1]*(1-drag.pitch*.25),oe[2]*(1+drag.pitch*2.2)];
    return {eye:rotY(oe,yaw),target:C,up:rotY([0,0,-1],yaw),fov:48};
  }

  function project(p){
    var m=VP, cw=m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];
    if(cw<.05) return null;
    var cx=(m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12])/cw, cy=(m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13])/cw;
    return {x:(cx*.5+.5)*W,y:(.5-cy*.5)*H,w:cw};
  }

  /* ---------- M and S, drawn crisp on the 2D layer ---------- */
  var HEART=new Path2D("M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z");
  var SHINE=new Path2D("M18 34 C 17 24, 23 16, 32 14");
  function grad(stops){ var g=o.createRadialGradient(36,28,4,46,48,62); stops.forEach(function(s){ g.addColorStop(s[0],s[1]); }); return g; }
  var RUBY=grad([[0,"#ff8aa0"],[.45,"#e8335a"],[.8,"#b0123d"],[1,"#7a0a28"]]), GOLD=grad([[0,"#fff6d8"],[.4,"#f6d58a"],[.78,"#dca84a"],[1,"#a06d1f"]]);
  function makeGlow(rgb){ var c=document.createElement("canvas"); c.width=c.height=128; var g=c.getContext("2d"), gr=g.createRadialGradient(64,64,0,64,64,64);
    gr.addColorStop(0,"rgba("+rgb+",.85)"); gr.addColorStop(.3,"rgba("+rgb+",.3)"); gr.addColorStop(1,"rgba("+rgb+",0)"); g.fillStyle=gr; g.fillRect(0,0,128,128); return c; }
  var GLOW_R=makeGlow("255,70,110"), GLOW_G=makeGlow("255,210,130");
  function hero(p,D,gold,letter,a,beat){
    if(!p||a<.01) return;
    o.save(); o.globalAlpha=a;
    o.globalCompositeOperation="lighter"; o.drawImage(gold?GLOW_G:GLOW_R,p.x-D*1.4,p.y-D*1.4,D*2.8,D*2.8); o.globalCompositeOperation="source-over";
    var k=D/100*(1+.07*beat);
    o.translate(p.x,p.y); o.scale(k,k); o.translate(-50,-47);
    o.fillStyle=gold?GOLD:RUBY; o.fill(HEART);
    o.lineCap="round"; o.strokeStyle="rgba(255,255,255,.55)"; o.lineWidth=4; o.stroke(SHINE);
    o.fillStyle=gold?"#8e0f2e":"#f7e3b0"; o.font="34px "+SCRIPT; o.textAlign="center"; o.textBaseline="middle";
    o.shadowColor=gold?"rgba(255,255,255,.35)":"rgba(60,0,20,.45)"; o.shadowBlur=3;
    o.fillText(letter,50,45);
    o.restore();
  }
  function heroSize(p,minD){ return clamp(2.6*(H/2/Math.tan(camNow.fov*Math.PI/360))/p.w,minD,Math.min(W,H)*.46); }

  /* ---------- text ---------- */
  var PEOPLE=8328955303;   // people on Earth, the count the galaxy climbs to
  var numShown="";
  function setOn(el,v){ if(el.classList.contains("on")!==v) el.classList.toggle("on",v); }
  function ui(tt){
    setOn(elCount,T>=.8&&tt<AT.dive+.2);
    if(T>=0&&tt<AT.dive){
      var n=tt>=AT.hold?PEOPLE:Math.min(PEOPLE,Math.exp(Math.log(PEOPLE)*eio(ss(.05,.97,tt/DUR.out)))), str=Math.max(1,Math.round(n)).toLocaleString("en-US");
      if(str!==numShown){ numShown=str; elNum.textContent=str; }
    }
    setOn(elEnd,T>=0&&tt>=AT.final+.6); elReplay.hidden=!(T>=0&&tt>=AT.final+2.2);
  }

  /* ---------- frame ---------- */
  function frame(now){
    if(dead) return;
    raf=requestAnimationFrame(frame);
    if(paused){ last=0; return; }
    var dt=last?Math.min(.05,Math.max(0,(now-last)/1000)):0; last=now;
    time+=dt; if(T>=0) T+=dt;
    if(!ptr.down){ drag.yaw*=Math.pow(.04,dt); drag.pitch*=Math.pow(.04,dt); }
    render();
  }

  function render(){
    var tt=Math.max(0,T);
    camNow=camAt(tt);
    VP=mul(persp(camNow.fov*Math.PI/180,W/H,.3,20000),lookAt(camNow.eye,camNow.target,camNow.up));
    FOCAL=(glc.height/2)/Math.tan(camNow.fov*Math.PI/360);

    var galA=T<0?0:tt<DUR.out?ss(.04,.3,tt/DUR.out):tt<AT.final?1:.78;
    var fu=clamp((tt-AT.flight)/DUR.flight,0,1), inFlight=T>=0&&tt>=AT.flight&&tt<AT.found;
    var tipPos=at(LP,tipL(fu));
    var progL=T<0||tt<AT.flight?0:tt<AT.found?TL.uEnd*tipL(fu)/Ll:lerp(TL.uEnd,1,eio(clamp((tt-AT.found)/.9,0,1)));
    var progR=tt<AT.rise||T<0?0:eio(clamp((tt-AT.rise-.3)/4.5,0,1));
    var flow=T<0?0:ss(AT.final-1,AT.final+1.5,tt);
    var wt=time-wave.t0, waveR=wt*620, waveA=wt<2.4?1-wt/2.4:0, waveO=wave.o;
    if(T>=0&&tt>=AT.found&&tt<AT.found+2.4){ var fw=tt-AT.found; if((1-fw/2.4)*.9>waveA){ waveR=fw*520; waveA=(1-fw/2.4)*.9; waveO=S; } }

    if(gl){
      gl.viewport(0,0,glc.width,glc.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ZERO,gl.ONE);
      if(galA>.003){
        gl.useProgram(PG.p); var U=PG.u;
        gl.uniformMatrix4fv(U.uVP,false,VP); gl.uniform1f(U.uFocal,FOCAL); gl.uniform1f(U.uTime,time);
        gl.uniform3fv(U.uTip,tipPos); gl.uniform1f(U.uTipOn,inFlight?1:0); gl.uniform1f(U.uAlpha,galA);
        gl.uniform3fv(U.uWaveO,waveO); gl.uniform1f(U.uWave,waveR); gl.uniform1f(U.uWaveA,waveA);
        gl.uniform1f(U.uMaxPx,Math.min(110*DPR,MAXPT)); gl.uniform1f(U.uDPR,DPR);
        var camD=Math.hypot(camNow.eye[0],camNow.eye[1],camNow.eye[2]); gl.uniform1f(U.uGain,1+2.4*ss(250,2500,camD));
        gl.bindBuffer(gl.ARRAY_BUFFER,bufG);
        gl.enableVertexAttribArray(PG.a.aPos); gl.vertexAttribPointer(PG.a.aPos,3,gl.FLOAT,false,32,0);
        gl.enableVertexAttribArray(PG.a.aCol); gl.vertexAttribPointer(PG.a.aCol,4,gl.FLOAT,false,32,12);
        gl.enableVertexAttribArray(PG.a.aPh); gl.vertexAttribPointer(PG.a.aPh,1,gl.FLOAT,false,32,28);
        gl.drawArrays(gl.POINTS,0,N);
        gl.disableVertexAttribArray(PG.a.aPos); gl.disableVertexAttribArray(PG.a.aCol); gl.disableVertexAttribArray(PG.a.aPh);
      }
      gl.useProgram(PT.p); var V=PT.u;
      gl.uniformMatrix4fv(V.uVP,false,VP); gl.uniform1f(V.uFocal,FOCAL); gl.uniform1f(V.uTime,time); gl.uniform1f(V.uDPR,DPR);
      gl.uniform2f(V.uRes,glc.width,glc.height); gl.uniform1f(V.uFlow,flow);
      var thread=function(buf,tb,progv,col,glowCol,head,headK){
        var cnt=countUpTo(tb,progv); if(cnt<2) return;
        gl.bindBuffer(gl.ARRAY_BUFFER,buf);
        gl.enableVertexAttribArray(PT.a.aP); gl.vertexAttribPointer(PT.a.aP,4,gl.FLOAT,false,32,0);
        gl.enableVertexAttribArray(PT.a.aN); gl.vertexAttribPointer(PT.a.aN,4,gl.FLOAT,false,32,16);
        gl.uniform1f(V.uProg,progv); gl.uniform3fv(V.uHead,head); gl.uniform1f(V.uHeadK,headK);
        // wide soft glow, then the fine bright core
        gl.uniform3fv(V.uCol,glowCol); gl.uniform1f(V.uSize,.7); gl.uniform1f(V.uMinPx,10); gl.uniform1f(V.uMaxPx,26); gl.uniform1f(V.uAlpha,.2); gl.uniform1f(V.uEdge,2.2);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,cnt*2);
        gl.uniform3fv(V.uCol,col); gl.uniform1f(V.uSize,.14); gl.uniform1f(V.uMinPx,2.2); gl.uniform1f(V.uMaxPx,6); gl.uniform1f(V.uAlpha,.95); gl.uniform1f(V.uEdge,1.6);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,cnt*2);
        gl.disableVertexAttribArray(PT.a.aP); gl.disableVertexAttribArray(PT.a.aN);
      };
      thread(bufL,TL,progL,[1,.42,.55],[1,.18,.36],[1,.92,.92],tt<AT.found?70:0);
      thread(bufR,TR,progR,[1,.84,.55],[1,.62,.25],[1,.97,.86],progR<1?60:0);
    }

    // the 2D layer: M, S and the moment they meet
    o.setTransform(DPR,0,0,DPR,0,0); o.clearRect(0,0,W,H);
    var beat=beatShape(frac(time*1.15)), finalMin=clamp(Math.min(W,H)*.085,34,64);
    var minD=T<0?0:tt<AT.dive?26:tt>=AT.rise?lerp(26,finalMin,ss(AT.rise+2,AT.final,tt)):18;
    var pm=project(M), ps=project(S);
    var sA=T<0||tt<AT.flight?0:tt<AT.found?ss(.8,.9,fu):1;
    if(T>=0&&tt>=AT.found&&tt<AT.found+1.6){
      var fl=(tt-AT.found)/1.6;
      if(ps){ var dS=heroSize(ps,minD), rr=dS*3*eOut(fl)+dS;
        o.globalCompositeOperation="lighter";
        o.globalAlpha=(1-fl)*.9; o.strokeStyle="#f7e3b0"; o.lineWidth=2; o.beginPath(); o.arc(ps.x,ps.y,dS*(.6+2.6*eOut(fl)),0,TAU); o.stroke();
        o.globalAlpha=(1-fl)*.6; o.drawImage(GLOW_G,ps.x-rr,ps.y-rr,rr*2,rr*2);
        o.globalCompositeOperation="source-over"; o.globalAlpha=1; }
      if(!vibFound&&!paused){ vibFound=true; vib([20,60,30]); }
    }
    o.globalCompositeOperation="lighter";
    if(inFlight){ var ph=project(tipPos); if(ph){ var hs=clamp(60*(H/2/Math.tan(camNow.fov*Math.PI/360))/ph.w,14,70); o.globalAlpha=.9; o.drawImage(GLOW_R,ph.x-hs,ph.y-hs,hs*2,hs*2); } }
    if(progR>0&&progR<1){ var pr=project(at(RP,RP.len*progR)); if(pr){ o.globalAlpha=.9; o.drawImage(GLOW_G,pr.x-26,pr.y-26,52,52); } }
    o.globalCompositeOperation="source-over"; o.globalAlpha=1;
    var tp=time-tapPulse, tb=tp<.6?bump(tp,.6)*.6:0;
    if(pm&&T<0&&!reduced){
      var dM=heroSize(pm,minD);
      for(var q=0;q<2;q++){ var rp=frac(time/2.2+q*.5);
        o.globalAlpha=.45*(1-rp)*ss(0,.15,rp); o.strokeStyle="#f7e3b0"; o.lineWidth=1.5;
        o.beginPath(); o.arc(pm.x,pm.y,dM*(.62+.7*eOut(rp)),0,TAU); o.stroke(); }
      o.globalAlpha=1;
    }
    if(pm) hero(pm,heroSize(pm,minD),false,"M",1,beat+tb);
    if(ps) hero(ps,heroSize(ps,minD),true,"S",sA,beat+tb);

    if(T>=0&&tt>=AT.final){ var pc=project([0,0,52]); if(pc) elEndPos.style.top=pc.y+"px"; }
    ui(tt);
  }

  /* ---------- input ---------- */
  function start(){ T=reduced?AT.final+.5:0; vibFound=false; numShown=""; wave.t0=-99; drag.yaw=drag.pitch=0; }
  function setPtr(e){ var r=ov.getBoundingClientRect(); ptr.x=e.clientX-r.left; ptr.y=e.clientY-r.top; ptr.nx=ptr.x/W*2-1; ptr.ny=ptr.y/H*2-1; }
  on(ov,"pointerdown",function(e){
    setPtr(e); ptr.down=true; ptr.moved=0;
    try{ ov.setPointerCapture(e.pointerId); }catch(_){}
    if(T<0){ start(); vib(15); }
  });
  on(ov,"pointermove",function(e){
    var px=ptr.x, py=ptr.y; setPtr(e);
    if(ptr.down&&T>=AT.final){ ptr.moved+=Math.abs(ptr.x-px)+Math.abs(ptr.y-py); drag.yaw=clamp(drag.yaw+(ptr.x-px)*.004,-.5,.5); drag.pitch=clamp(drag.pitch+(ptr.y-py)*.003,-.4,.4); }
  });
  on(ov,"pointerup",function(){
    if(ptr.down&&T>=AT.final&&ptr.moved<10){ wave.t0=time; wave.o=C; tapPulse=time; vib(12); }
    ptr.down=false;
  });
  on(ov,"pointercancel",function(){ ptr.down=false; });
  on(ov,"keydown",function(e){ if((e.key===" "||e.key==="Enter")&&T<0){ e.preventDefault(); start(); } });
  on(elReplay,"click",start);
  on(window,"resize",resize);
  on(glc,"webglcontextlost",function(e){ e.preventDefault(); gl=null; });
  resize();
  if(document.fonts&&document.fonts.load) document.fonts.load("34px "+SCRIPT).catch(function(){});
  if(!gl) T=AT.final+.5;
  raf=requestAnimationFrame(frame);

  return function stop(){
    dead=true; cancelAnimationFrame(raf); offs.forEach(function(f){ f(); }); timers.forEach(clearTimeout);
  };
}
