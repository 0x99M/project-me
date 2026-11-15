/* eslint-disable */
// The /hearts-v2 engine: one canvas, no React state.
// startHeartsV2() wires everything up and returns a cleanup that stops the frame loop, timers and listeners.
export function startHeartsV2(root) {
  "use strict";
  var dead = false, raf = 0, offs = [], timers = [];
  function on(el, type, fn, opt){ el.addEventListener(type, fn, opt); offs.push(function(){ el.removeEventListener(type, fn, opt); }); }
  var $ = function(id){ return root.querySelector("#" + id); };
  var cv = $("fx"), c = cv.getContext("2d");
  var halo = $("halo"), hint = $("hint"), hintText = $("hintText"), rep = $("replay");
  var cs = getComputedStyle(root);
  var SCRIPT = (cs.getPropertyValue("--font-hv2-script").trim() || '"Great Vibes"') + ", cursive";
  var ARABIC = cs.getPropertyValue("--font-hv2-ar").trim() || '"Amiri"';
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The heart from /hearts, in a 100-unit box; its centre is (50, 47).
  var HEART_D = "M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z";
  var HEART = new Path2D(HEART_D);
  var SHINE = new Path2D("M16 35 C 15 24, 22 15, 32 13");

  function rnd(a, b){ return a + Math.random() * (b - a); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function easeIn(t){ return t * t * t; }
  function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

  /* ---------- sprites: soft glowing dots, drawn once ---------- */
  function dot(col){
    var s = 48, o = document.createElement("canvas"); o.width = o.height = s; var g = o.getContext("2d"), m = s / 2;
    var gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, "rgba(255,250,240,1)"); gr.addColorStop(.18, col); gr.addColorStop(.42, col.replace("1)", ".55)")); gr.addColorStop(1, col.replace("1)", "0)"));
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return o;
  }
  var GOLD = ["rgba(247,227,176,1)", "rgba(227,191,120,1)", "rgba(240,206,140,1)"].map(dot);
  var RUBY = ["rgba(255,114,134,1)", "rgba(223,51,82,1)", "rgba(255,150,170,1)", "rgba(200,30,70,1)"].map(dot);
  var SPARK = dot("rgba(255,222,150,1)");

  /* ---------- the heart's inside and rim, as points in its box (for bubbles, sparks and the burst) ---------- */
  var INSIDE = [], RIM = [];
  (function(){
    var k = 3, o = document.createElement("canvas"); o.width = o.height = 100 * k; var g = o.getContext("2d");
    g.scale(k, k); g.fillStyle = "#f00"; g.fill(HEART); g.strokeStyle = "#0f0"; g.lineWidth = 1.2; g.stroke(HEART);
    var d = g.getImageData(0, 0, o.width, o.height).data;
    for(var y = 0; y < o.height; y += 2) for(var x = 0; x < o.width; x += 2){
      var i = (y * o.width + x) * 4;
      if(d[i + 1] > 120) RIM.push([x / k, y / k]); else if(d[i] > 120) INSIDE.push([x / k, y / k]);
    }
  })();

  /* ---------- layout ---------- */
  var W = 0, H = 0, DPR = 1, hx = 0, hy = 0, hs = 1;
  function size(){
    DPR = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    hs = Math.min(W * .62, H * .4) / 100; hx = W / 2; hy = H * .45;
    halo.style.left = hx + "px"; halo.style.top = hy + "px";
    if(state === "formed" || state === "forming") placeTargets(true);
  }

  /* ---------- state ---------- */
  var state = "idle", holding = false, level = 0, agit = 0, press = 1, squeeze = 1, squeezeT0 = 0;
  var beatPhase = 0, lastLub = 0, kick = 0;
  var P = [], FX = [], BUB = [], DUST = [], targets = null, formT0 = 0, formEnd = 0, hc = { x:0, y:0 };
  var ptr = { x:-1e4, y:-1e4, vx:0, vy:0, active:false, down:false, id:null, sx:0, sy:0, moved:0 };

  for(var i = 0; i < 46; i++) DUST.push({ x:Math.random(), y:Math.random(), v:rnd(.00002, .00006), r:rnd(.6, 1.6), ph:rnd(0, 6.3) });

  function showHint(t){ hintText.textContent = t; hint.classList.remove("off"); }
  function hideHint(){ hint.classList.add("off"); }

  // lub-dub: two bumps per beat, the second softer
  function bump(x, w){ return x < 0 || x > w ? 0 : Math.sin(Math.PI * x / w); }
  function beatShape(f){ return bump(f, .13) + .55 * bump(f - .2, .13); }

  /* ---------- particles that will write M ❤ S ---------- */
  function buildTargets(){
    var fs = clamp(Math.min(W * .21, H * .3), 70, 200);
    var heartW = clamp(Math.min(W * .22, H * .3), 80, 190);
    var gap = clamp(W * .045, 14, 48);
    var o = document.createElement("canvas"); o.width = W; o.height = H; var g = o.getContext("2d");
    g.font = fs + "px " + SCRIPT;
    var mM = g.measureText("M"), mS = g.measureText("S");
    var wM = mM.actualBoundingBoxRight + mM.actualBoundingBoxLeft, wS = mS.actualBoundingBoxRight + mS.actualBoundingBoxLeft;
    var total = wM + gap + heartW + gap + wS, f = Math.min(1, (W - 40) / total);
    if(f < 1){ fs *= f; heartW *= f; gap *= f; g.font = fs + "px " + SCRIPT;
      mM = g.measureText("M"); mS = g.measureText("S");
      wM = mM.actualBoundingBoxRight + mM.actualBoundingBoxLeft; wS = mS.actualBoundingBoxRight + mS.actualBoundingBoxLeft;
      total = wM + gap + heartW + gap + wS; }
    var x0 = (W - total) / 2, cy = hy;
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgb(255,0,0)";
    g.fillText("M", x0 + mM.actualBoundingBoxLeft, cy + (mM.actualBoundingBoxAscent - mM.actualBoundingBoxDescent) / 2);
    var sx = x0 + wM + gap + heartW + gap;
    g.fillText("S", sx + mS.actualBoundingBoxLeft, cy + (mS.actualBoundingBoxAscent - mS.actualBoundingBoxDescent) / 2);
    var k = heartW / 88, hl = x0 + wM + gap;
    hc = { x:hl + heartW / 2, y:cy };
    g.setTransform(k, 0, 0, k, hl - 6 * k, cy - 47 * k);
    g.fillStyle = "rgb(0,255,0)"; g.fill(HEART);
    g.strokeStyle = "rgb(0,0,255)"; g.lineWidth = 4; g.stroke(HEART);
    g.setTransform(1, 0, 0, 1, 0, 0);
    var d = g.getImageData(0, 0, W, H).data, step = Math.max(3, Math.round(Math.min(W, H) / 170)), pts;
    for(;;){
      pts = [];
      for(var row = 0, y = 0; y < H; y += step * .87, row++){
        for(var x = (row % 2) * step / 2; x < W; x += step){
          var i = ((y | 0) * W + (x | 0)) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
          if(b > 120) pts.push({ x:x, y:y, kind:"rim" });
          else if(gg > 120) pts.push({ x:x, y:y, kind:"heart" });
          else if(r > 120) pts.push({ x:x, y:y, kind:"letter" });
        }
      }
      if(pts.length <= 2600) break; step += 1;
    }
    var minX = 1e9, maxX = -1e9; pts.forEach(function(p){ minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
    return { pts:pts, step:step, minX:minX, maxX:maxX };
  }

  function placeTargets(snap){ // after a resize: rebuild targets and drop every particle on its new spot
    targets = buildTargets();
    P = targets.pts.map(function(t){ return makeParticle(t, t.x, t.y, 0); });
    if(state === "forming") state = "formed";
  }

  function makeParticle(t, x, y, delay){
    var gold = t.kind !== "heart";
    return { x:x, y:y, vx:0, vy:0, tx:t.x, ty:t.y, kind:t.kind, delay:delay,
      spr: gold ? GOLD[(Math.random() * GOLD.length) | 0] : RUBY[(Math.random() * RUBY.length) | 0],
      from: RUBY[(Math.random() * RUBY.length) | 0], ph:rnd(0, 6.3), sz:rnd(.85, 1.2) };
  }

  function explode(now){
    targets = buildTargets();
    var s = hs * .92, span = Math.max(1, targets.maxX - targets.minX);
    P = targets.pts.map(function(t){
      var q = INSIDE[(Math.random() * INSIDE.length) | 0];
      var x = hx + (q[0] - 50) * s, y = hy + (q[1] - 47) * s;
      var p = makeParticle(t, x, y, reduced ? 0 : 520 + (t.x - targets.minX) / span * 760 + rnd(0, 160));
      var dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy) || 1, sp = rnd(3, 13) * Math.min(W, H) / 700;
      p.vx = dx / d * sp - dy / d * rnd(-2.5, 2.5); p.vy = dy / d * sp + dx / d * rnd(-2.5, 2.5) - rnd(0, 2);
      if(reduced){ p.x = t.x; p.y = t.y; p.vx = p.vy = 0; }
      return p;
    });
    formT0 = now; formEnd = now + (reduced ? 300 : 520 + 760 + 160 + 1300);
    state = "forming"; level = 0;
    if(!reduced){
      ring(hx, hy, 20, Math.max(W, H) * .7, "rgba(247,214,140,", 1100, 3);
      ring(hx, hy, 10, Math.max(W, H) * .45, "rgba(255,120,145,", 900, 6);
      for(var i = 0; i < 70; i++){ var a = rnd(0, 6.3), v = rnd(2, 11); spark(hx, hy, Math.cos(a) * v, Math.sin(a) * v, rnd(600, 1300)); }
    }
    halo.style.left = hc.x + "px"; halo.style.top = hc.y + "px";
    halo.animate([{ opacity:0, transform:"scale(.5)" }, { opacity:1, transform:"scale(1.15)", offset:.18 }, { opacity:.38, transform:"scale(1)" }],
      { duration:reduced ? 10 : 1600, easing:"cubic-bezier(.16,.84,.3,1)", fill:"forwards" });
    buzz([18, 40, 30]);
  }

  /* ---------- small effects ---------- */
  function ring(x, y, r0, r1, col, life, lw){ FX.push({ ring:true, x:x, y:y, r0:r0, r1:r1, col:col, life:life, lw:lw, t0:performance.now() }); }
  function spark(x, y, vx, vy, life){ FX.push({ x:x, y:y, vx:vx, vy:vy, life:life, t0:performance.now(), sz:rnd(6, 14) }); }

  function shock(x, y){
    var R = Math.max(W, H) * .5;
    for(var i = 0; i < P.length; i++){
      var p = P[i], dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1, f = 20 * Math.exp(-d / (R * .35));
      p.vx += dx / d * f; p.vy += dy / d * f;
    }
    ring(x, y, 8, R * .8, "rgba(247,214,140,", 900, 2.5);
    for(var j = 0; j < 18; j++){ var a = rnd(0, 6.3), v = rnd(2, 7); spark(x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(400, 800)); }
    kick = 1; buzz(12);
  }

  /* ---------- drawing ---------- */
  var rimGrad = (function(){ var g = c.createLinearGradient(0, 0, 100, 100);
    g.addColorStop(0, "#fff3cf"); g.addColorStop(.35, "#e8c47e"); g.addColorStop(.62, "#a9772f"); g.addColorStop(.85, "#f3d99a"); g.addColorStop(1, "#c8964a"); return g; })();
  var liquid = (function(){ var g = c.createLinearGradient(0, 10, 0, 88);
    g.addColorStop(0, "#ff6f8a"); g.addColorStop(.45, "#d81e48"); g.addColorStop(1, "#6e0820"); return g; })();

  function heartTransform(s){ c.setTransform(DPR * s, 0, 0, DPR * s, DPR * (hx - 50 * s), DPR * (hy - 47 * s)); }

  function wave(y0, amp, ph, kx, fill, stroke){
    c.beginPath(); c.moveTo(0, 100); c.lineTo(0, y0);
    for(var x = 0; x <= 100; x += 2) c.lineTo(x, y0 + amp * Math.sin(x * kx + ph) + amp * .45 * Math.sin(x * kx * 2.1 - ph * 1.6));
    c.lineTo(100, 100); c.closePath(); c.fillStyle = fill; c.fill();
    if(stroke){ c.beginPath();
      for(var x2 = 0; x2 <= 100; x2 += 2){ var yy = y0 + amp * Math.sin(x2 * kx + ph) + amp * .45 * Math.sin(x2 * kx * 2.1 - ph * 1.6); x2 ? c.lineTo(x2, yy) : c.moveTo(x2, yy); }
      c.strokeStyle = stroke; c.lineWidth = .9; c.stroke(); }
  }

  function drawHeart(now, beat){
    var s = hs * press * squeeze * (1 + beat * (.035 + .05 * level));
    heartTransform(s);
    // the dark glass body and its glow
    c.save(); c.shadowColor = "rgba(255,80,115," + (.18 + .55 * level) + ")"; c.shadowBlur = (24 + 40 * level) * DPR;
    c.fillStyle = "rgba(48,10,26,.72)"; c.fill(HEART); c.restore();
    // the liquid
    if(level > .003){
      c.save(); c.clip(HEART);
      var top = 3, bot = 90, y0 = bot - level * (bot - top);
      var amp = .7 + 3.4 * agit, ph = now * .004;
      wave(y0 + 1.2, amp * .9, ph * 1.3 + 2, .08, "rgba(140,14,48,.95)");
      wave(y0, amp, ph, .07, liquid, "rgba(255,190,205,.55)");
      for(var i = 0; i < BUB.length; i++){ var b = BUB[i]; if(b.y > y0 + 1){ c.beginPath(); c.arc(b.x, b.y, b.r, 0, 6.283); c.fillStyle = "rgba(255,205,215," + (.25 + .2 * Math.sin(b.ph + now * .01)) + ")"; c.fill(); } }
      // inner shine on the glass
      c.fillStyle = "rgba(255,255,255,.07)"; c.beginPath(); c.ellipse(30, 26, 17, 9, -.55, 0, 6.283); c.fill();
      c.restore();
    }
    // gold rim, brighter as it fills
    c.lineJoin = "round"; c.lineWidth = 2.4; c.strokeStyle = rimGrad;
    c.shadowColor = "rgba(247,214,140,.85)"; c.shadowBlur = (5 + 18 * level + 10 * beat * level) * DPR; c.stroke(HEART); c.shadowBlur = 0;
    c.lineCap = "round"; c.lineWidth = 1.6; c.strokeStyle = "rgba(255,255,255," + (.35 + .3 * level) + ")"; c.stroke(SHINE);
  }

  function drawDust(now){
    for(var i = 0; i < DUST.length; i++){
      var d = DUST[i]; d.y -= d.v * 16; if(d.y < -.02){ d.y = 1.02; d.x = Math.random(); }
      var a = .22 + .2 * Math.sin(now * .0012 + d.ph), r = d.r * 5;
      c.globalAlpha = a; c.drawImage(SPARK, (d.x * W + Math.sin(now * .0004 + d.ph) * 12) * DPR - r * DPR / 2, d.y * H * DPR - r * DPR / 2, r * DPR, r * DPR);
    }
    c.globalAlpha = 1;
  }

  function drawFX(now, dtn){
    for(var i = FX.length - 1; i >= 0; i--){
      var f = FX[i], t = Math.max(0, (now - f.t0) / f.life); // rAF time can lag performance.now()
      if(t >= 1){ FX.splice(i, 1); continue; }
      if(f.ring){
        var e = 1 - Math.pow(1 - t, 3), r = f.r0 + (f.r1 - f.r0) * e;
        c.beginPath(); c.arc(f.x * DPR, f.y * DPR, Math.max(0, r) * DPR, 0, 6.283);
        c.strokeStyle = f.col + ((1 - t) * .8).toFixed(3) + ")"; c.lineWidth = f.lw * DPR * (1 - t * .6); c.stroke();
      } else {
        f.vx *= Math.pow(.95, dtn); f.vy = f.vy * Math.pow(.95, dtn) + .04 * dtn; f.x += f.vx * dtn; f.y += f.vy * dtn;
        var sz = f.sz * (1 - t * .5) * DPR;
        c.globalAlpha = 1 - t; c.drawImage(SPARK, f.x * DPR - sz / 2, f.y * DPR - sz / 2, sz, sz);
      }
    }
    c.globalAlpha = 1;
  }

  /* ---------- the loop ---------- */
  var last = performance.now();
  function frame(now){
    var dt = Math.min(48, now - last); last = now; var dtn = dt / 16.667;

    if(state === "idle" || state === "squeeze"){
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    } else {
      // fade the last frame instead of clearing it, so moving particles leave short trails
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "destination-out";
      c.fillStyle = state === "forming" ? "rgba(0,0,0,.26)" : "rgba(0,0,0,.42)"; c.fillRect(0, 0, cv.width, cv.height);
      c.globalCompositeOperation = "source-over";
    }
    drawDust(now);

    if(state === "idle"){
      if(holding) level = Math.min(1, level + dt * (.55 + .9 * level) / 1800);
      else level = Math.max(0, level - dt / 1100);
      agit = holding ? Math.min(1, agit + .03 * dtn) : agit * Math.pow(.97, dtn);
      press += ((holding ? .955 : 1) - press) * Math.min(1, .25 * dtn);
      var bpm = 58 + 100 * level; beatPhase += dt * bpm / 60000;
      var f = beatPhase % 1, beat = reduced ? 0 : beatShape(f);
      if(holding && Math.floor(beatPhase) !== lastLub){ lastLub = Math.floor(beatPhase); buzz(10); }
      // bubbles and rim sparks while filling
      if(holding && level > .04 && Math.random() < .5 * dtn) BUB.push({ x:rnd(22, 78), y:90, r:rnd(.5, 1.6), v:rnd(.25, .7), ph:rnd(0, 6.3) });
      for(var i = BUB.length - 1; i >= 0; i--){ var b = BUB[i]; b.y -= b.v * dtn; b.x += Math.sin(now * .004 + b.ph) * .08; if(b.y < 90 - level * 87) BUB.splice(i, 1); }
      if(holding && !reduced && Math.random() < (.15 + .6 * level) * dtn){
        var q = RIM[(Math.random() * RIM.length) | 0], s = hs * press;
        var sx = hx + (q[0] - 50) * s, sy = hy + (q[1] - 47) * s, dx = sx - hx, dy = sy - hy, dd = Math.hypot(dx, dy) || 1;
        spark(sx, sy, dx / dd * rnd(.4, 1.6), dy / dd * rnd(.4, 1.6) - rnd(.3, 1.2), rnd(500, 1000));
      }
      drawHeart(now, beat);
      if(level >= 1){ state = "squeeze"; squeezeT0 = now; holding = false; hideHint(); }
    } else if(state === "squeeze"){
      var k = Math.min(1, (now - squeezeT0) / (reduced ? 1 : 260));
      squeeze = 1 - .2 * easeIn(k); agit = 1; level = 1;
      drawHeart(now, 0);
      if(k >= 1 && fontsReady){ squeeze = 1; explode(now); }
    }

    c.setTransform(1, 0, 0, 1, 0, 0);
    drawFX(now, dtn);

    if(state === "forming" || state === "formed"){
      var age = now - formT0, bt = (now - formT0) / 1000 * 1.15 % 1;
      kick *= Math.pow(.9, dtn);
      var hb = 1 + (reduced ? 0 : .055 * beatShape(bt) + .08 * kick);
      var R = Math.max(70, Math.min(W, H) * .14), R2 = R * R;
      ptr.vx *= Math.pow(.8, dtn); ptr.vy *= Math.pow(.8, dtn);
      var base = targets.step * 2.4 * DPR;
      for(var j = 0; j < P.length; j++){
        var p = P[j], tx = p.tx, ty = p.ty;
        if(p.kind !== "letter"){ tx = hc.x + (p.tx - hc.x) * hb; ty = hc.y + (p.ty - hc.y) * hb; }
        if(age < p.delay){ // free flight, curling around the centre
          var cx = p.x - hx, cy2 = p.y - hy;
          p.vx = p.vx * Math.pow(.955, dtn) - cy2 * .0011 * dtn; p.vy = p.vy * Math.pow(.955, dtn) + cx * .0011 * dtn;
        } else {
          var K = state === "formed" ? .05 : .04, D = .845;
          p.vx = (p.vx + (tx - p.x) * K * dtn) * Math.pow(D, dtn); p.vy = (p.vy + (ty - p.y) * K * dtn) * Math.pow(D, dtn);
        }
        if(ptr.active){
          var dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
          if(d2 < R2){ var d = Math.sqrt(d2) || 1, f = 1 - d / R, f2 = f * f;
            p.vx += (dx / d * 5.5 - dy / d * 1.6) * f2 * dtn + ptr.vx * f2 * .4;
            p.vy += (dy / d * 5.5 + dx / d * 1.6) * f2 * dtn + ptr.vy * f2 * .4; }
        }
        p.x += p.vx * dtn; p.y += p.vy * dtn;
        // gold particles turn from ruby to gold as they arrive
        var m = age < p.delay ? 0 : Math.min(1, (age - p.delay) / 700);
        var tw = p.kind === "heart" ? 1 : .78 + .22 * Math.sin(now * .003 + p.ph);
        var sp = Math.min(1.6, Math.hypot(p.vx, p.vy) * .06);
        var sz = base * p.sz * (1 + sp * .5);
        var X = p.x * DPR - sz / 2, Y = p.y * DPR - sz / 2;
        if(p.kind === "heart" || m >= 1){ c.globalAlpha = tw; c.drawImage(p.spr, X, Y, sz, sz); }
        else { c.globalAlpha = 1 - m; c.drawImage(p.from, X, Y, sz, sz); c.globalAlpha = m * tw; c.drawImage(p.spr, X, Y, sz, sz); }
      }
      c.globalAlpha = 1;
      if(state === "forming" && now > formEnd){ state = "formed"; showHint("حرّك إصبعك بين الحروف"); rep.hidden = false; }
    }
    if(!dead) raf = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  function startHold(){ if(state !== "idle") return; holding = true; hideHint(); }
  function endHold(){ if(!holding) return; holding = false; if(state === "idle" && level > .02) showHint("استمر بالضغط…"); }

  on(cv, "pointerdown", function(e){
    ptr.down = true; ptr.id = e.pointerId; ptr.x = ptr.sx = e.clientX; ptr.y = ptr.sy = e.clientY; ptr.vx = ptr.vy = 0; ptr.moved = 0;
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    if(state === "idle") startHold();
    else if(state === "formed" || state === "forming") ptr.active = true;
  });
  on(cv, "pointermove", function(e){
    var nx = e.clientX, ny = e.clientY;
    ptr.vx = ptr.vx * .5 + (nx - ptr.x) * .5; ptr.vy = ptr.vy * .5 + (ny - ptr.y) * .5;
    ptr.moved += Math.abs(nx - ptr.x) + Math.abs(ny - ptr.y); ptr.x = nx; ptr.y = ny;
    if(e.pointerType === "mouse" && (state === "formed" || state === "forming")) ptr.active = true;
  });
  function up(e){
    if(ptr.down && (state === "formed") && ptr.moved < 10) shock(ptr.x, ptr.y);
    ptr.down = false; if(e.pointerType !== "mouse") ptr.active = false; endHold();
  }
  on(cv, "pointerup", up);
  on(cv, "pointercancel", up);
  on(cv, "pointerleave", function(e){ if(e.pointerType === "mouse"){ ptr.active = false; } });
  on(cv, "contextmenu", function(e){ e.preventDefault(); });
  on(window, "keydown", function(e){
    if(e.key !== " " && e.key !== "Enter") return; if(document.activeElement === rep) return;
    e.preventDefault(); if(e.repeat) return;
    if(state === "idle") startHold(); else if(state === "formed") shock(hc.x, hc.y);
  });
  on(window, "keyup", function(e){ if(e.key === " " || e.key === "Enter") endHold(); });
  on(window, "blur", endHold);

  on(rep, "click", function(){
    state = "idle"; level = 0; agit = 0; P = []; BUB = []; FX = []; rep.hidden = true;
    halo.getAnimations().forEach(function(a){ a.cancel(); });
    halo.style.left = hx + "px"; halo.style.top = hy + "px";
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
    showHint("اضغط مطوّلاً على القلب"); cv.focus({ preventScroll:true });
  });

  var fontsReady = false;
  Promise.all([document.fonts.load("100px " + SCRIPT), document.fonts.load("20px " + ARABIC)])
    .catch(function(){}).then(function(){ fontsReady = true; });
  timers.push(setTimeout(function(){ fontsReady = true; }, 2500)); // never wait forever for a font

  on(window, "resize", size);
  size();
  raf = requestAnimationFrame(frame);

  return function stop(){
    dead = true; cancelAnimationFrame(raf);
    timers.forEach(clearTimeout); offs.forEach(function(off){ off(); });
    halo.getAnimations().forEach(function(a){ a.cancel(); });
  };
}
