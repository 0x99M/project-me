/* eslint-disable */
// The /hearts animation engine: plain DOM + one canvas, no React state.
// startHearts() wires everything up and returns a cleanup that stops every timer, frame and listener.
export function startHearts(root) {
  "use strict";
  var dead = false, timeouts = new Set(), intervals = new Set(), offs = [];
  root.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
  function setTimeout(f, ms) { var id = window.setTimeout(function () { timeouts.delete(id); if (!dead) f(); }, ms); timeouts.add(id); return id; }
  function setInterval(f, ms) { var id = window.setInterval(function () { if (!dead) f(); }, ms); intervals.add(id); return id; }
  function clearInterval(id) { window.clearInterval(id); intervals.delete(id); }
  function requestAnimationFrame(f) { return window.requestAnimationFrame(function (t) { if (!dead) f(t); }); }
  function on(el, type, fn, opt) { el.addEventListener(type, fn, opt); offs.push(function () { el.removeEventListener(type, fn, opt); }); }
  function addEventListener(type, fn, opt) { on(window, type, fn, opt); }

  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function(id){ return document.getElementById(id); };
  var cv = $("fx"), c = cv.getContext("2d"), guide = $("guide"), ink = $("ink"), hint = $("hint"), rep = $("replay"), big = $("big");
  var W = 0, H = 0, DPR = 1, C = { x:0, y:0, w:100 };
  function rnd(a, b){ return a + Math.random() * (b - a); }
  function pick(a){ return a[Math.floor(Math.random() * a.length)]; }
  function easeIO(t){ return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t){ return 1 - Math.pow(1 - t, 3); }
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function anim(el, kf, o){ return el.animate(kf, Object.assign({ fill:"both", easing:"cubic-bezier(.16,.84,.3,1)" }, o)).finished; }
  function heartXY(t){ // the classic heart curve: x in -16..16, y grows downwards
    return [16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - 2];
  }

  /* ---------- sprites, drawn once and stamped many times ---------- */
  var HP = new Path2D("M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z");
  function heartSprite(col, glow, blur){
    var s = 64, pad = 28, o = document.createElement("canvas"); o.width = o.height = s + pad * 2;
    var g = o.getContext("2d"); if(blur) g.filter = "blur(" + blur + "px)";
    g.translate(pad, pad); g.scale(s / 24, s / 24);
    if(glow){ g.shadowColor = glow; g.shadowBlur = 14; }
    var gr = g.createLinearGradient(0, 3, 0, 21); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr; g.fill(HP);
    if(!blur){ g.shadowBlur = 0; g.strokeStyle = "rgba(255,255,255,.45)"; g.lineWidth = .9; g.lineCap = "round";
      g.beginPath(); g.moveTo(5.2, 7); g.quadraticCurveTo(5.8, 5, 8, 4.7); g.stroke(); }
    return o;
  }
  function sparkSprite(col){
    var s = 64, o = document.createElement("canvas"); o.width = o.height = s; var g = o.getContext("2d"), m = s / 2;
    var gr = g.createRadialGradient(m, m, 0, m, m, m); gr.addColorStop(0, col); gr.addColorStop(.25, col.replace(/[\d.]+\)$/, ".35)")); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,248,228,.95)"; g.beginPath();
    g.moveTo(m, m - 26); g.lineTo(m + 3, m); g.lineTo(m, m + 26); g.lineTo(m - 3, m); g.closePath();
    g.moveTo(m - 26, m); g.lineTo(m, m - 3); g.lineTo(m + 26, m); g.lineTo(m, m + 3); g.closePath(); g.fill();
    return o;
  }
  var COLS = [["#ff8da0", "#e02f50"], ["#ff5f78", "#b5163a"], ["#ffc3cc", "#f08396"], ["#f9dfa0", "#d9a957"], ["#e8405e", "#8f0f2b"], ["#fbd0d6", "#e6667f"]];
  function mip(o){ // half and quarter size copies, so small stamps never shrink a big image each frame
    o._m = [o];
    for(var lv = 1, prev = o; lv < 3; lv++){ var n = document.createElement("canvas"); n.width = Math.ceil(prev.width / 2); n.height = Math.ceil(prev.height / 2);
      n.getContext("2d").drawImage(prev, 0, 0, n.width, n.height); o._m.push(n); prev = n; }
    return o;
  }
  var HEARTS = COLS.map(function(col){ return mip(heartSprite(col, col[1])); });
  var BOKEH = COLS.map(function(col){ return mip(heartSprite(col, null, 5)); });
  var SPARK = [sparkSprite("rgba(255,222,150,1)"), sparkSprite("rgba(255,160,175,1)"), sparkSprite("rgba(255,244,220,1)")].map(mip);

  /* ---------- particles ---------- */
  var mosaic = null; // the finished heart of hearts, baked into one image while it beats and falls in
  var parts = [], stars = [], last = performance.now(), ambientOn = false, acc = { bokeh:0, dust:0 }, nextShoot = 0;
  function add(p){
    if(parts.length > 900) return null;
    var q = Object.assign({ x:0, y:0, vx:0, vy:0, g:0, drag:.985, life:1500, age:0, size:10, rot:0, vr:0, a:1, sway:0, sf:1, ph:Math.random() * 6, blend:"source-over" }, p);
    parts.push(q); return q;
  }
  function fadeAlpha(p, t){ return t < .1 ? t / .1 : t > .62 ? 1 - (t - .62) / .38 : 1; }
  function size(){
    DPR = Math.min(maxDPR, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    stars = []; for(var i = 0, n = Math.round(W * H / 5200); i < n; i++) stars.push({ x:Math.random() * W, y:Math.random() * H, r:rnd(.4, 1.4), ph:rnd(0, 6), sp:rnd(.6, 2) });
    var r = big.getBoundingClientRect(); C = { x:r.left + r.width / 2, y:r.top + r.height * .52, w:r.width };
    [guide, $("rays"), $("halo")].forEach(function(el){ el.style.left = C.x + "px"; el.style.top = C.y + "px"; });
    hint.style.top = (C.y + guide.getBoundingClientRect().height / 2 + 26) + "px";
  }
  addEventListener("resize", size);
  addEventListener("orientationchange", size);

  // adaptive quality: if frames run long on a slow phone, drop the canvas resolution and the ambient density
  var slow = 0, lowQ = false, maxDPR = 2, lit = [];
  function frame(now){
    var dt = Math.min(48, now - last), k = dt / 16.67; last = now;
    if(!lowQ && document.visibilityState === "visible"){ slow = dt > 24 ? slow + 1 : Math.max(0, slow - 1); if(slow > 24){ lowQ = true; maxDPR = 1.25; size(); } }
    c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
    c.fillStyle = "#fff3dc";
    for(var i = 0; i < stars.length; i++){ var s = stars[i]; c.globalAlpha = .18 + .32 * (.5 + .5 * Math.sin(now / 1000 * s.sp + s.ph)); c.fillRect(s.x, s.y, s.r, s.r); }
    spawnAmbient(dt, now);
    if(mosaic){
      var tr = mosaic.xf(now);
      if(tr){ var bx = mosaic.box; c.globalAlpha = 1; c.setTransform(DPR * tr, 0, 0, DPR * tr, C.x * (1 - tr) * DPR, C.y * (1 - tr) * DPR); c.drawImage(mosaic.cv, bx.x, bx.y, bx.w, bx.h); }
      else mosaic = null;
    }
    lit.length = 0;
    for(var j = parts.length - 1; j >= 0; j--){
      var p = parts[j]; p.age += dt;
      if(p.age >= p.life){ parts[j] = parts[parts.length - 1]; parts.pop(); continue; }
      if(p.baked) continue;
      if(p.update) p.update(p, k, now);
      else {
        var d = Math.pow(p.drag, k); p.vx *= d; p.vy = p.vy * d + p.g * k; p.x += p.vx * k; p.y += p.vy * k;
        if(p.sway) p.x += Math.sin(p.age / 380 * p.sf + p.ph) * p.sway * k;
      }
      p.rot += p.vr * k;
      if(p.blend === "lighter") lit.push(p);
      else {
        draw(p, c, DPR);
        // a heart that has settled into the mosaic is stamped once into the baked image and then left alone
        if(mosaic && p.settled && p.settled(now)){ draw(p, mosaic.g, mosaic.dpr, mosaic.box.x, mosaic.box.y); p.baked = true; }
      }
    }
    // additive sparks last, in one pass, so the canvas switches blend mode once per frame
    c.globalCompositeOperation = "lighter";
    for(var m = 0; m < lit.length; m++) draw(lit[m], c, DPR);
    c.globalCompositeOperation = "source-over"; c.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  function draw(p, g, dpr, ox, oy){
    var al = (p.alpha ? p.alpha(p, p.age / p.life) : fadeAlpha(p, p.age / p.life)) * p.a;
    if(al <= 0.003) return;
    g.globalAlpha = al > 1 ? 1 : al;
    if(p.ring){
      var t = easeOut(p.age / p.life), rr = p.r0 + (p.r1 - p.r0) * t;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.strokeStyle = p.color; g.lineWidth = p.lw * (1 - t) + .5;
      g.beginPath(); g.arc(p.x, p.y, rr, 0, 7); g.stroke();
    } else {
      var sc = (p.scale ? p.scale(p) : 1) * p.size / 64 * dpr; if(sc <= 0) return;
      var img = p.img, px = img.width * sc, src = img._m ? img._m[px < img.width * .3 ? 2 : px < img.width * .6 ? 1 : 0] : img;
      sc *= img.width / src.width;
      var cs = Math.cos(p.rot) * sc, sn = Math.sin(p.rot) * sc;
      g.setTransform(cs, sn, -sn, cs, (p.x - (ox || 0)) * dpr, (p.y - (oy || 0)) * dpr);
      g.drawImage(src, -src.width / 2, -src.height / 2);
    }
  }

  function spark(x, y, o){ return add(Object.assign({ img:pick(SPARK), x:x, y:y, size:rnd(10, 22), life:rnd(700, 1400), blend:"lighter", drag:.94, g:.02 }, o || {})); }
  function heart(x, y, o){ return add(Object.assign({ img:pick(HEARTS), x:x, y:y, size:rnd(12, 22), rot:rnd(-.4, .4) }, o || {})); }
  function ring(x, y, r0, r1, color, life, lw){ return add({ ring:true, x:x, y:y, r0:r0, r1:r1, color:color, life:life, lw:lw || 3, alpha:function(p, t){ return 1 - t; } }); }
  function burstHearts(x, y, n, spd, o){
    for(var i = 0; i < n; i++){ var a = rnd(0, Math.PI * 2), v = rnd(spd * .35, spd);
      heart(x, y, Object.assign({ vx:Math.cos(a) * v, vy:Math.sin(a) * v, drag:.95, g:.05, life:rnd(1600, 2800), vr:rnd(-.03, .03) }, o || {})); }
  }
  function burstSparks(x, y, n, spd){
    for(var i = 0; i < n; i++){ var a = rnd(0, Math.PI * 2), v = rnd(spd * .3, spd); spark(x, y, { vx:Math.cos(a) * v, vy:Math.sin(a) * v }); }
  }

  /* ambient life: rising soft hearts, gold dust, a shooting heart now and then */
  function spawnAmbient(dt, now){
    if(reduced) return;
    acc.bokeh += dt;
    var every = (ambientOn ? 210 : 650) * (lowQ ? 1.8 : 1);
    while(acc.bokeh > every){ acc.bokeh -= every;
      var front = Math.random() < (ambientOn ? .35 : .2);
      add({ img:front ? pick(HEARTS) : pick(BOKEH), x:rnd(0, W), y:H + 30, vy:rnd(-1.3, -.55) * (front ? 1.2 : 1), drag:1, sway:rnd(.2, .6), sf:rnd(.5, 1.3),
        size:front ? rnd(9, 18) : rnd(16, 46), life:rnd(6500, 10000), rot:rnd(-.3, .3), vr:rnd(-.004, .004), a:front ? rnd(.5, .85) : rnd(.18, .4),
        alpha:function(p, t){ return t < .12 ? t / .12 : t > .7 ? 1 - (t - .7) / .3 : 1; } });
    }
    if(!ambientOn) return;
    acc.dust += dt;
    var dustEvery = lowQ ? 180 : 90;
    while(acc.dust > dustEvery){ acc.dust -= dustEvery;
      var a = rnd(0, Math.PI * 2), r = C.w * rnd(.6, 2.6);
      spark(C.x + Math.cos(a) * r * 1.5, C.y + Math.sin(a) * r * .8, { vx:0, vy:rnd(-.4, -.1), drag:1, g:0, size:rnd(6, 14), life:rnd(900, 1800), alpha:function(p, t){ return Math.sin(t * Math.PI); } });
    }
    if(now > nextShoot){ nextShoot = now + rnd(3800, 6200); shootingHeart(); }
  }
  function shootingHeart(){
    var fromLeft = Math.random() < .5, y0 = rnd(H * .08, H * .3), x0 = fromLeft ? -30 : W + 30, dir = fromLeft ? 1 : -1, spd = rnd(5, 7.5), drop = rnd(.6, 1.4);
    add({ img:HEARTS[pick([0, 1, 3])], x:x0, y:y0, size:rnd(16, 22), life:(W + 80) / spd * 16.67, rot:dir * .3, a:.95,
      update:function(p, k){ p.x += dir * spd * k; p.y = y0 + Math.sin(p.age / 700) * 26 * drop + p.age / 60 * drop;
        if(Math.random() < .9) spark(p.x - dir * 8, p.y + rnd(-3, 3), { vx:-dir * rnd(.3, 1.2), vy:rnd(-.3, .3), size:rnd(6, 12), life:rnd(500, 900), g:.01 }); },
      alpha:function(){ return 1; } });
  }

  /* touch the screen to leave hearts */
  var lastTrail = 0;
  addEventListener("pointermove", function(e){
    if(reduced || e.timeStamp - lastTrail < 45) return; lastTrail = e.timeStamp;
    heart(e.clientX, e.clientY, { size:rnd(9, 16), vx:rnd(-.6, .6), vy:rnd(-1.4, -.5), drag:.99, g:-.005, life:rnd(1100, 1700), vr:rnd(-.02, .02) });
  }, { passive:true });
  addEventListener("pointerdown", function(e){
    if(reduced || stage !== "done" || e.target.closest("button")) return;
    burstHearts(e.clientX, e.clientY, 12, 5.5, { size:rnd(10, 18), g:.03 }); burstSparks(e.clientX, e.clientY, 10, 4);
    ring(e.clientX, e.clientY, 6, 70, "rgba(247,214,140,.7)", 700, 2);
  });

  /* ---------- the story ---------- */
  var playing = false, beatTimer = 0;
  async function play(origins){
    if(playing) return; playing = true; stage = "playing";
    size();
    hint.animate([{ opacity:getComputedStyle(hint).opacity }, { opacity:0 }], { duration:300, fill:"forwards" });
    anim(guide, [{ opacity:1, transform:"translate(-50%,-50%) scale(1.06)" }, { opacity:0, transform:"translate(-50%,-50%) scale(1.02)" }], { duration:420, easing:"ease-in" });
    if(reduced){ await wait(400); return finale(); }
    ring(C.x, C.y, 30, Math.max(W, H) * .7, "rgba(255,190,200,.45)", 1300, 4);
    ring(C.x, C.y, 20, Math.max(W, H) * .45, "rgba(247,214,140,.55)", 1100, 3);

    // 2 · two pens trace the outline from the tip up to the cleft, the burst hearts land behind them
    // 3 · the inside fills with hearts from the bottom up, 4 · the mosaic beats, 5 · it falls into the centre
    var RO = Math.min(W * .8, H * .58) / 34, SZ = RO * 1.55, B = 800, T = 1700, FLY = 480, FILL = 1200, HD = 1500, CL = 600;
    var FS = B + T + FLY - 60, HS = FS + FILL + 560, END = HS + HD + CL, t0 = performance.now();
    var pts = []; for(var i = 0; i <= 720; i++){ var xy = heartXY(i / 720 * Math.PI * 2); pts.push([C.x + xy[0] * RO, C.y + xy[1] * RO]); }
    function side(arr){ var cum = [0]; for(var i = 1; i < arr.length; i++) cum.push(cum[i - 1] + Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1])); return { p:arr, c:cum, L:cum[cum.length - 1] }; }
    function at(s, d){ var i = 1; while(i < s.c.length - 1 && s.c[i] < d) i++; var f = (d - s.c[i - 1]) / ((s.c[i] - s.c[i - 1]) || 1);
      return [s.p[i - 1][0] + (s.p[i][0] - s.p[i - 1][0]) * f, s.p[i - 1][1] + (s.p[i][1] - s.p[i - 1][1]) * f]; }
    var right = side(pts.slice(0, 361).reverse()), left = side(pts.slice(360)), n = Math.max(12, Math.round(right.L / (SZ * .86)));
    var slots = [];
    for(var k = 0; k <= n; k++){
      [right, left].forEach(function(s, si){ if(si && (k === 0 || k === n)) return; var q = at(s, k / n * s.L); slots.push({ x:q[0], y:q[1], key:k / n }); });
    }
    var tipY = pts[360][1], topY = Math.min.apply(null, pts.map(function(q){ return q[1]; }));
    // interior: a honeycomb of places that sit inside the outline
    var tc = document.createElement("canvas").getContext("2d"), path = new Path2D();
    pts.forEach(function(q, i){ i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1]); });
    var gap = SZ * .8, inner = [], few = pts.filter(function(q, i){ return i % 3 === 0; });
    for(var y = topY, row = 0; y < tipY; y += gap * .87, row++) for(var x = C.x - 17 * RO + (row % 2) * gap / 2; x < C.x + 17 * RO; x += gap){
      if(!tc.isPointInPath(path, x, y)) continue;
      var md = 1e9; few.forEach(function(q){ md = Math.min(md, Math.hypot(q[0] - x, q[1] - y)); });
      if(md < gap * .78) continue;
      var r = Math.hypot((x - C.x) / (16 * RO), (y - C.y - 2 * RO) / (14 * RO));
      inner.push({ x:x + rnd(-1, 1), y:y + rnd(-1, 1), img:HEARTS[pick(r < .38 ? [4, 1] : r < .68 ? [1, 0, 1] : [0, 5, 2])],
        delay:FS + (tipY - y) / (tipY - topY) * FILL + Math.sin(x * .045) * 70 });
    }
    function beatF(t){ var h = (t - HS) % 750 / 750; return 1 + .065 * Math.max(0, Math.sin(h * Math.PI * 2)) * (h < .5 ? 1 : .5); }
    // the baked image only covers the heart itself, so stamping it each frame stays cheap
    var box = { x:C.x - 17 * RO - SZ, y:topY - SZ, w:34 * RO + SZ * 2, h:tipY - topY + SZ * 2 };
    var bk = document.createElement("canvas"); bk.width = Math.ceil(box.w * DPR); bk.height = Math.ceil(box.h * DPR);
    mosaic = { cv:bk, g:bk.getContext("2d"), dpr:DPR, box:box, xf:function(now){ // the mosaic's scale about the centre
      var t = now - t0;
      if(t < HS) return 1;
      if(t < END - CL) return beatF(t);
      if(t < END) return 1 - .97 * Math.pow((t - (END - CL)) / CL, 3);
      return 0;
    } };
    function place(p, t, now){ // shared by every heart once it has its place
      if(t < HS){ p.x = p.tx; p.y = p.ty; }
      else if(t < END - CL){ var f = beatF(t); p.x = C.x + (p.tx - C.x) * f; p.y = C.y + (p.ty - C.y) * f + Math.sin(now / 170 + p.ph) * .4; }
      else { var q = Math.pow(Math.min(1, (t - (END - CL)) / CL), 3); p.x = p.tx + (C.x - p.tx) * q; p.y = p.ty + (C.y - p.ty) * q; }
    }
    function shrink(){ var t = performance.now() - t0; return t > END - CL ? 1 - .6 * Math.pow(Math.min(1, (t - (END - CL)) / CL), 2) : 1; }
    function backOut(e){ var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(e - 1, 3) + c1 * Math.pow(e - 1, 2); }

    // burst hearts, matched to outline places by angle so their paths do not cross
    var flyers = [];
    for(var b = 0; b < slots.length; b++){ // each gold heart is born from a point of the drawn S
      var o = origins[Math.floor(b * origins.length / slots.length)];
      flyers.push({ x:o[0], y:o[1], a:Math.atan2(o[1] - C.y, o[0] - C.x), v:rnd(.4, 1.6) });
    }
    flyers.sort(function(p, q){ return p.a - q.a; });
    var bySlot = slots.map(function(s){ return { s:s, a:Math.atan2(s.y - C.y, s.x - C.x) }; }).sort(function(p, q){ return p.a - q.a; });
    flyers.forEach(function(f, i){
      var s = bySlot[i].s;
      heart(f.x, f.y, { img:HEARTS[3], size:SZ * rnd(.95, 1.08), vx:Math.cos(f.a) * f.v, vy:Math.sin(f.a) * f.v, rot:rnd(-.6, .6), life:END + 60,
        tx:s.x, ty:s.y, ts:B + s.key * T, alpha:function(p){ return p.age < 120 ? p.age / 120 : 1; }, scale:shrink,
        settled:function(){ return this.landed === 1; },
        update:function(p, k, now){
          var t = now - t0;
          if(t < p.ts){ var d = Math.pow(t < B ? .9 : .985, k); p.vx *= d; p.vy *= d; p.x += p.vx * k; p.y += p.vy * k + Math.sin(now / 500 + p.ph) * .15 * k; }
          else if(t < p.ts + FLY){
            if(p.sx == null){ p.sx = p.x; p.sy = p.y; p.sr = p.rot; }
            var e = easeOut((t - p.ts) / FLY), nx = -(p.ty - p.sy), ny = p.tx - p.sx, nl = Math.hypot(nx, ny) || 1, arc = Math.sin(e * Math.PI) * 18;
            p.x = p.sx + (p.tx - p.sx) * e + nx / nl * arc; p.y = p.sy + (p.ty - p.sy) * e + ny / nl * arc; p.rot = p.sr * (1 - e);
          } else {
            if(!p.landed){ p.landed = 1; p.rot = 0; for(var m = 0; m < 3; m++) spark(p.tx, p.ty, { vx:rnd(-1.2, 1.2), vy:rnd(-1.2, .6), size:rnd(8, 14), life:rnd(400, 700) }); }
            place(p, t, now);
          }
        } });
    });

    // the pens: a bright spark running up each side ahead of the landing hearts
    var pens = setInterval(function(){
      var t = performance.now() - t0, u = (t - B) / T; if(u < 0) return; if(u > 1){ clearInterval(pens); return; }
      [right, left].forEach(function(s){ var q = at(s, u * s.L); spark(q[0], q[1], { size:rnd(16, 26), vx:rnd(-.4, .4), vy:rnd(-.4, .4), life:rnd(380, 620) }); });
    }, 28);

    inner.forEach(function(s){
      heart(s.x, s.y, { img:s.img, size:SZ * rnd(.86, 1), rot:rnd(-.18, .18), life:END + 60, tx:s.x, ty:s.y, delay:s.delay,
        alpha:function(p){ var t = performance.now() - t0; return t < p.delay ? 0 : Math.min(1, (t - p.delay) / 140); },
        scale:function(p){ var t = performance.now() - t0; return (t < p.delay ? 0 : backOut(Math.min(1, (t - p.delay) / 380))) * shrink(); },
        settled:function(now){ return now - t0 > this.delay + 390; },
        update:function(p, k, now){ place(p, now - t0, now); } });
    });

    // a glint sweeps across the finished heart while it beats
    var glint = setInterval(function(){
      var t = performance.now() - t0; if(t < HS) return; if(t > END - CL){ clearInterval(glint); return; }
      var u = (t - HS) / HD, lp = (C.x - 17 * RO + tipY) + u * (34 * RO + (tipY - topY)) * 1.1;
      inner.concat(slots).forEach(function(s){ if(Math.abs(s.x + (tipY - s.y) - lp) < 5 && Math.random() < .5) spark(s.x, s.y, { size:rnd(10, 18), vx:0, vy:-.3, g:0, life:rnd(350, 600) }); });
    }, 40);
    await wait(HS);
    ring(C.x, C.y, RO * 6, RO * 26, "rgba(247,214,140,.35)", 1100, 2);
    await wait(END - HS);
    return finale();
  }

  async function finale(){
    var lm = $("lm"), ls = $("ls");
    if(!reduced){
      ring(C.x, C.y, C.w * .3, Math.max(W, H) * .8, "rgba(255,170,185,.65)", 1500, 6);
      setTimeout(function(){ ring(C.x, C.y, C.w * .3, Math.max(W, H) * .55, "rgba(247,214,140,.7)", 1300, 3); }, 140);
      burstHearts(C.x, C.y, 56, 15); burstSparks(C.x, C.y, 70, 12);
    }
    anim($("halo"), [{ opacity:0, transform:"scale(.3)" }, { opacity:1, transform:"scale(1)" }], { duration:1200 });
    anim($("rays"), [{ opacity:0 }, { opacity:1 }], { duration:2400, easing:"ease-out" });
    await anim(big, [{ transform:"scale(0)", opacity:0 }, { transform:"scale(1.3)", opacity:1, offset:.55 }, { transform:"scale(.94)", opacity:1, offset:.8 }, { transform:"scale(1)", opacity:1 }], { duration:900, easing:"cubic-bezier(.2,.8,.25,1)" });
    if(!reduced){
      big.animate([{ transform:"scale(1)" }, { transform:"scale(1.11)", offset:.12 }, { transform:"scale(.98)", offset:.24 }, { transform:"scale(1.06)", offset:.36 }, { transform:"scale(1)", offset:.55 }, { transform:"scale(1)" }], { duration:1500, iterations:Infinity, easing:"ease-in-out" });
      var beat = function(){
        ring(C.x, C.y, C.w * .45, C.w * 1.9, "rgba(255,150,170,.42)", 1300, 2.5);
        for(var i = 0; i < 4; i++){ var a = rnd(Math.PI * 1.1, Math.PI * 1.9); heart(C.x, C.y - C.w * .1, { size:rnd(8, 13), vx:Math.cos(a) * rnd(1.2, 2.6), vy:Math.sin(a) * rnd(1.4, 2.8), drag:.985, g:-.004, life:rnd(1800, 2600) }); }
      };
      beat(); beatTimer = setInterval(beat, 1500);
      // a slow shine glides across the ruby now and then
      $("sheen").animate([{ transform:"skewX(-18deg) translateX(0)" }, { transform:"skewX(-18deg) translateX(200px)", offset:.4 }, { transform:"skewX(-18deg) translateX(200px)" }], { duration:4200, iterations:Infinity, easing:"ease-in-out", delay:600 });
      ambientOn = true; nextShoot = performance.now() + 1800;
    }
    // the letters are written in, left to right, as if by a pen
    var write = [{ clipPath:"inset(0 100% 0 0)", opacity:1 }, { clipPath:"inset(0 0 0 0)", opacity:1 }];
    // a spark rides the pen's edge across each letter
    function pen(el, delay, dur){
      setTimeout(function(){
        var r = el.getBoundingClientRect(), s0 = performance.now(), id = setInterval(function(){
          var u = (performance.now() - s0) / dur; if(u > 1){ clearInterval(id); return; }
          var e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
          spark(r.left + r.width * e, r.top + r.height * rnd(.25, .8), { size:rnd(12, 22), vx:rnd(-.6, .2), vy:rnd(-.5, .5), life:rnd(400, 700) });
        }, 30);
      }, delay);
    }
    if(!reduced){ pen(lm, 0, 1500); pen(ls, 1250, 1500); }
    anim(lm, write, { duration:1500, easing:"cubic-bezier(.45,.05,.35,1)" });
    await anim(ls, write, { duration:1500, delay:1250, easing:"cubic-bezier(.45,.05,.35,1)" });
    rep.hidden = false; playing = false; stage = "done";
  }

  /* ---------- drawing the S to begin ---------- */
  var stage = "idle", L = ink.getTotalLength(), NS = 240, gp = [], fw = 0, bw = NS - 1, drawing = false, lastPt = null, scr = [], tol = 40;
  for(var gi = 0; gi < NS; gi++){ var gq = ink.getPointAtLength(gi / (NS - 1) * L); gp.push([gq.x, gq.y]); }
  function screenPts(){ var r = guide.getBoundingClientRect(), sc = r.height / 260; scr = gp.map(function(q){ return [r.left + q[0] * sc, r.top + q[1] * sc]; }); return r.height * .17; }
  function showInk(){ // whichever end the S is being drawn from, show the traced part in gold
    var f = fw / (NS - 1), b = (NS - 1 - bw) / (NS - 1);
    ink.style.strokeDasharray = f >= b ? (L * f) + " " + (L + 1) : "0 " + (L * (1 - b)) + " " + (L * b + 1);
    $("start").style.opacity = f > .02 || b > .02 ? 0 : 1;
    return Math.max(f, b);
  }
  function track(x, y){
    var j, best = -1;
    for(j = fw; j <= Math.min(NS - 1, fw + 26); j++) if(Math.hypot(scr[j][0] - x, scr[j][1] - y) < tol) best = j;
    if(best > fw) fw = best;
    best = -1;
    for(j = bw; j >= Math.max(0, bw - 26); j--) if(Math.hypot(scr[j][0] - x, scr[j][1] - y) < tol) best = j;
    if(best >= 0 && best < bw) bw = best;
  }
  on(guide, "pointerdown", function(e){
    if(stage !== "idle") return;
    drawing = true; tol = screenPts(); lastPt = [e.clientX, e.clientY];
    try{ guide.setPointerCapture(e.pointerId); }catch(_){}
    track(e.clientX, e.clientY); showInk();
  });
  on(guide, "pointermove", function(e){
    if(!drawing || stage !== "idle") return;
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if(!evs.length) evs = [e];
    evs.forEach(function(ev){
      var x = ev.clientX, y = ev.clientY, dx = x - lastPt[0], dy = y - lastPt[1], steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
      for(var i = 1; i <= steps; i++) track(lastPt[0] + dx * i / steps, lastPt[1] + dy * i / steps);
      lastPt = [x, y];
    });
    if(!reduced) spark(e.clientX, e.clientY, { size:rnd(12, 22), vx:rnd(-.6, .6), vy:rnd(-.6, .6), life:rnd(400, 700) });
    if(showInk() >= .93) done();
  });
  function endDraw(){ drawing = false; }
  on(guide, "pointerup", endDraw); on(guide, "pointercancel", endDraw);
  on(guide, "keydown", function(e){ // keyboard: Enter writes the S by itself
    if(stage !== "idle" || (e.key !== "Enter" && e.key !== " ")) return; e.preventDefault();
    var s0 = performance.now(); screenPts();
    (function step(now){ var u = Math.min(1, (now - s0) / 900); fw = Math.round(u * (NS - 1)); showInk();
      if(!reduced) spark(scr[fw][0], scr[fw][1], { size:rnd(12, 22), life:rnd(400, 700) });
      if(u < 1) requestAnimationFrame(step); else done(); })(s0);
  });
  function done(){
    if(stage !== "idle") return; stage = "playing"; drawing = false; fw = NS - 1; bw = NS - 1; showInk(); screenPts();
    if(!reduced) for(var i = 0; i < NS; i += 4) spark(scr[i][0], scr[i][1], { size:rnd(14, 26), vx:rnd(-1, 1), vy:rnd(-1, 1), life:rnd(600, 1000) });
    var origins = scr.filter(function(q, i){ return i % 2 === 0; });
    setTimeout(function(){ play(origins); }, 260);
  }
  // while nobody has started, a spark shows which way the S is written
  setInterval(function(){
    if(stage !== "idle" || drawing || fw > 0 || bw < NS - 1 || reduced) return;
    screenPts(); var s0 = performance.now();
    var id = setInterval(function(){ var u = (performance.now() - s0) / 1700; if(u > 1 || drawing || stage !== "idle"){ clearInterval(id); return; }
      var q = scr[Math.round(u * (NS - 1))]; spark(q[0], q[1], { size:rnd(10, 18), vx:rnd(-.3, .3), vy:rnd(-.3, .3), life:rnd(500, 800), a:.8 }); }, 30);
  }, 4200);

  function reset(){
    mosaic = null; clearInterval(beatTimer); ambientOn = false; parts = parts.filter(function(p){ return p.tx == null; });
    [guide, hint, big, $("sheen"), $("lm"), $("ls"), $("rays"), $("halo")].forEach(function(el){ el.getAnimations().forEach(function(a){ a.cancel(); }); });
    fw = 0; bw = NS - 1; showInk(); stage = "idle"; rep.hidden = true; size(); guide.focus({ preventScroll:true });
  }

  on(rep, "click", reset);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(size);
  showInk(); size(); requestAnimationFrame(frame);

  return function stop() {
    dead = true;
    timeouts.forEach(function (id) { window.clearTimeout(id); });
    intervals.forEach(function (id) { window.clearInterval(id); });
    offs.forEach(function (off) { off(); });
    parts = [];
    root.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); });
  };
}
