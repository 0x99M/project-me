/* eslint-disable */
// The /hearts-v6 engine: one 2D canvas. A rose heart is struck again and again until it shatters (a Voronoi fracture
// with jagged shared edges). A small golden heart comes down, a clear spring (Salsabil) wells up around it, and she
// drags the pieces into the water, where they gather over the golden heart and every crack fills with gold (kintsugi).
// The mended heart turns wholly gold, the water rises to fill the screen, and small hearts bloom around it while a
// gold heart and a rose heart trace an endless loop. No words. startHeartsV6(root) returns a cleanup.
export function startHeartsV6(root) {
  const cv = root.querySelector("#hv6-cv");
  let ctx = cv.getContext("2d");
  const againBtn = root.querySelector("#hv6-again");
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const listeners = [];
  function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); listeners.push([el, ev, fn, o]); }
  let dead = false, raf = 0, capTimer = 0, endTimer = 0;

  // ---------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pip(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function pulse(ph) {
    ph = ph - Math.floor(ph);
    return Math.exp(-Math.pow((ph - 0.1) / 0.07, 2)) + 0.55 * Math.exp(-Math.pow((ph - 0.34) / 0.07, 2));
  }
  // critically damped spring: smooth acceleration, no jumps when the target moves
  function spring(o, tx, ty, w, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let k = 0; k < n; k++) {
      o.vx += (w * w * (tx - o.x) - 2 * w * o.vx) * h; o.vy += (w * w * (ty - o.y) - 2 * w * o.vy) * h;
      o.x += o.vx * h; o.y += o.vy * h;
    }
  }

  // ---------- the heart from /hearts..v5, in its 100-unit box. Unit space: height 1, centred on (50, 47).
  const HEART_D = "M50 88 C 46 84, 6 60, 6 32 C 6 16, 18 6, 31 6 C 40 6, 47 11, 50 19 C 53 11, 60 6, 69 6 C 82 6, 94 16, 94 32 C 94 60, 54 84, 50 88 Z";
  const HEART_SVG = new Path2D(HEART_D), SHINE_SVG = new Path2D("M18 34 C 17 24, 23 16, 32 14");
  const HU = 82, HCX = 50, HCY = 47;
  const HP = (function () {
    const segs = [[[50, 88], [46, 84], [6, 60], [6, 32]], [[6, 32], [6, 16], [18, 6], [31, 6]], [[31, 6], [40, 6], [47, 11], [50, 19]],
      [[50, 19], [53, 11], [60, 6], [69, 6]], [[69, 6], [82, 6], [94, 16], [94, 32]], [[94, 32], [94, 60], [54, 84], [50, 88]]];
    const pts = [];
    for (const [a, b, c, d] of segs) for (let k = 0; k < 50; k++) {
      const t = k / 50, u = 1 - t;
      pts.push([(u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0] - HCX) / HU, (u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1] - HCY) / HU]);
    }
    return pts;
  })();
  const HB = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
  for (const p of HP) { HB.x0 = Math.min(HB.x0, p[0]); HB.x1 = Math.max(HB.x1, p[0]); HB.y0 = Math.min(HB.y0, p[1]); HB.y1 = Math.max(HB.y1, p[1]); }
  const heartPath = new Path2D();
  HP.forEach((p, k) => (k ? heartPath.lineTo(p[0], p[1]) : heartPath.moveTo(p[0], p[1])));
  heartPath.closePath();
  function edgeDist(x, y) { let m = 1e9; for (const p of HP) m = Math.min(m, Math.hypot(p[0] - x, p[1] - y)); return m; }
  const TX = { x0: -0.6, y0: -0.54, w: 1.2, h: 1.08 };

  // mat: 0 ruby, 1 bruised, 2 gold. Same gradient, shine stroke and shape as the earlier hearts.
  const MATS = [
    [[0, "#ff8aa0"], [0.45, "#e8335a"], [0.8, "#b0123d"], [1, "#7a0a28"]],
    [[0, "#a47b86"], [0.45, "#744253"], [0.8, "#4a1f2f"], [1, "#2c0e19"]],
    [[0, "#fff6d8"], [0.4, "#f6d58a"], [0.78, "#dca84a"], [1, "#a06d1f"]],
    [[0, "rgba(255,255,255,.9)"], [0.45, "rgba(196,242,255,.5)"], [0.8, "rgba(120,214,240,.34)"], [1, "rgba(86,192,232,.6)"]],
  ];
  function renderTex(mat, ppu) {
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(TX.w * ppu)); c.height = Math.max(2, Math.ceil(TX.h * ppu));
    const g = c.getContext("2d"), k = ppu / HU;
    g.setTransform(k, 0, 0, k, (-TX.x0 * HU - HCX) * k, (-TX.y0 * HU - HCY) * k);
    const gr = g.createRadialGradient(36, 28, 4, 46, 48, 62);
    for (const st of MATS[mat]) gr.addColorStop(st[0], st[1]);
    g.fillStyle = gr; g.fill(HEART_SVG);
    if (mat === 2) {
      const rim = g.createLinearGradient(0, 0, 100, 100);
      rim.addColorStop(0, "#fff3cf"); rim.addColorStop(0.35, "#e8c47e"); rim.addColorStop(0.62, "#a9772f"); rim.addColorStop(0.85, "#f3d99a"); rim.addColorStop(1, "#c8964a");
      g.lineJoin = "round"; g.lineWidth = 1.6; g.strokeStyle = rim; g.stroke(HEART_SVG);
    }
    g.lineCap = "round"; g.lineWidth = 4;
    g.strokeStyle = mat === 1 ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.55)"; g.stroke(SHINE_SVG);
    return c;
  }
  function glowSprite(r, g, b) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), q = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    q.addColorStop(0, `rgba(${r},${g},${b},1)`); q.addColorStop(0.25, `rgba(${r},${g},${b},.55)`); q.addColorStop(0.6, `rgba(${r},${g},${b},.13)`); q.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = q; x.fillRect(0, 0, 128, 128);
    return c;
  }
  const GLOW_W = glowSprite(255, 238, 244), GLOW_G = glowSprite(255, 200, 100), GLOW_R = glowSprite(160, 26, 66), GLOW_D = glowSprite(14, 0, 6), GLOW_P = glowSprite(255, 70, 110);
  function glow(sp, x, y, r, a) { if (a <= 0.003) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(sp, x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; }

  // ---------- fracture: Voronoi cells of seeds inside the heart, with jagged shared edges
  function clipPoly(poly, tags, mx, my, nx, ny, tag) {
    const out = [], ot = [], n = poly.length;
    for (let k = 0; k < n; k++) {
      const A = poly[(k + n - 1) % n], B = poly[k], t = tags[k];
      const da = (A[0] - mx) * nx + (A[1] - my) * ny, db = (B[0] - mx) * nx + (B[1] - my) * ny;
      const ia = da <= 0, ib = db <= 0;
      if (ia && ib) { out.push(B); ot.push(t); }
      else if (ia && !ib) { const f = da / (da - db); out.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]); ot.push(t); }
      else if (!ia && ib) { const f = da / (da - db); out.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]); ot.push(tag); out.push(B); ot.push(t); }
    }
    return [out, ot];
  }
  function pointAt(e, s) {
    const P = e.pts, C = e.cum;
    for (let k = 1; k < P.length; k++) {
      if (s <= C[k] || k === P.length - 1) {
        const t = C[k] > C[k - 1] ? clamp((s - C[k - 1]) / (C[k] - C[k - 1]), 0, 1) : 0;
        return [lerp(P[k - 1][0], P[k][0], t), lerp(P[k - 1][1], P[k][1], t)];
      }
    }
    return P[P.length - 1];
  }
  function rangePath(path, e, a, b) {
    const P = e.pts, C = e.cum;
    let started = false;
    for (let k = 1; k < P.length; k++) {
      const s0 = C[k - 1], s1 = C[k];
      if (s1 < a || s0 > b || s1 - s0 <= 0) continue;
      const t0 = Math.max(0, (a - s0) / (s1 - s0)), t1 = Math.min(1, (b - s0) / (s1 - s0));
      if (!started) { path.moveTo(lerp(P[k - 1][0], P[k][0], t0), lerp(P[k - 1][1], P[k][1], t0)); started = true; }
      path.lineTo(lerp(P[k - 1][0], P[k][0], t1), lerp(P[k - 1][1], P[k][1], t1));
    }
  }
  function build(seed) {
    const R = rng(seed);
    const seeds = [];
    for (let tries = 0; seeds.length < 22 && tries < 8000; tries++) {
      const x = (R() * 2 - 1) * 0.56, y = (R() * 2 - 1) * 0.52;
      if (!pip(HP, x, y)) continue;
      let ok = true;
      for (const s of seeds) if (Math.hypot(s[0] - x, s[1] - y) < 0.13) { ok = false; break; }
      if (ok) seeds.push([x, y]);
    }
    const edgeMap = new Map(), edges = [], shards = [];
    function makeEdge(A, B, i, j) {
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1e-6;
      const nx = -dy / len, ny = dx / len, k = Math.min(6, 1 + Math.floor(len / 0.045));
      const amp = Math.min(0.02, len * 0.15), pts = [A];
      for (let q = 1; q <= k; q++) {
        const t = clamp((q + (R() - 0.5) * 0.5) / (k + 1), 0.05, 0.95), off = (R() - 0.5) * 2 * amp * Math.sin(Math.PI * t);
        pts.push([A[0] + dx * t + nx * off, A[1] + dy * t + ny * off]);
      }
      pts.push(B);
      const cum = [0];
      for (let q = 1; q < pts.length; q++) cum.push(cum[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
      const e = { i, j, pts, cum, L: cum[cum.length - 1], crackAt: null, crackRev: false, crackDur: 1, done: false };
      const m = pointAt(e, e.L / 2); e.mx = m[0]; e.my = m[1];
      e.full = new Path2D(); rangePath(e.full, e, 0, e.L);
      return e;
    }
    for (let i = 0; i < seeds.length; i++) {
      let poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]], tags = [-1, -1, -1, -1];
      const si = seeds[i];
      for (let j = 0; j < seeds.length; j++) {
        if (j === i) continue;
        const sj = seeds[j];
        [poly, tags] = clipPoly(poly, tags, (si[0] + sj[0]) / 2, (si[1] + sj[1]) / 2, sj[0] - si[0], sj[1] - si[1], j);
      }
      const list = [], n = poly.length;
      for (let m = 0; m < n; m++) {
        const A = poly[(m + n - 1) % n], B = poly[m], tg = tags[m];
        if (tg < 0) { list.push(A); continue; }
        const key = Math.min(i, tg) + "," + Math.max(i, tg);
        let e = edgeMap.get(key);
        if (!e) { e = makeEdge(A, B, Math.min(i, tg), Math.max(i, tg)); edgeMap.set(key, e); edges.push(e); }
        const P = e.pts, last = P[P.length - 1];
        const fwd = (P[0][0] - A[0]) ** 2 + (P[0][1] - A[1]) ** 2 <= (last[0] - A[0]) ** 2 + (last[1] - A[1]) ** 2;
        const seq = fwd ? P : P.slice().reverse();
        for (let q = 0; q < seq.length - 1; q++) list.push(seq[q]);
      }
      const path = new Path2D();
      list.forEach((p, k) => (k ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
      path.closePath();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of list) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      x0 = Math.max(x0, HB.x0); x1 = Math.min(x1, HB.x1); y0 = Math.max(y0, HB.y0); y1 = Math.min(y1, HB.y1);
      const st = 0.01;
      let cnt = 0, sx = 0, sy = 0, bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
      for (let y = y0; y <= y1; y += st) for (let x = x0; x <= x1; x += st) {
        if (pip(list, x, y) && pip(HP, x, y)) { cnt++; sx += x; sy += y; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
      }
      const sh = { id: i, path, dummy: cnt === 0, state: "home", homeAt: -9, hurt: 0, ox: 0, oy: 0, r: 0, vx: 0, vy: 0, vr: 0 };
      if (cnt) {
        sh.px = sx / cnt; sh.py = sy / cnt; sh.rad = Math.sqrt((cnt * st * st) / Math.PI);
        sh.bx0 = bx0 - st * 1.5; sh.bx1 = bx1 + st * 1.5; sh.by0 = by0 - st * 1.5; sh.by1 = by1 + st * 1.5;
      }
      shards.push(sh);
    }
    const verts = [];
    function vid(p) {
      for (let k = 0; k < verts.length; k++) if (Math.abs(verts[k].x - p[0]) < 1e-4 && Math.abs(verts[k].y - p[1]) < 1e-4) return k;
      verts.push({ x: p[0], y: p[1], adj: [] });
      return verts.length - 1;
    }
    for (const e of edges) {
      e.va = vid(e.pts[0]); e.vb = vid(e.pts[e.pts.length - 1]);
      verts[e.va].adj.push(e); verts[e.vb].adj.push(e);
    }
    let cand = verts.map((v, k) => ({ x: v.x, y: v.y, id: k, deg: v.adj.length })).filter((v) => v.deg >= 3 && pip(HP, v.x, v.y) && edgeDist(v.x, v.y) > 0.1);
    if (cand.length < 6) cand = verts.map((v, k) => ({ x: v.x, y: v.y, id: k })).filter((v) => pip(HP, v.x, v.y) && edgeDist(v.x, v.y) > 0.04);
    const near = (tx, ty) => cand.reduce((b, v) => (Math.hypot(v.x - tx, v.y - ty) < Math.hypot(b.x - tx, b.y - ty) ? v : b), cand[0]);
    const finalImpact = near(0, 0.02);
    const impacts = [near(-0.22, -0.2)];
    while (impacts.length < 5) {
      let best = null, bd = -1;
      for (const v of cand) {
        let md = Math.hypot(v.x - finalImpact.x, v.y - finalImpact.y) * 0.8;
        for (const u of impacts) md = Math.min(md, Math.hypot(v.x - u.x, v.y - u.y));
        if (md > bd) { bd = md; best = v; }
      }
      impacts.push(best);
    }
    const allSeams = new Path2D();
    for (const e of edges) allSeams.addPath(e.full);
    return { shards, edges, verts, impacts, finalImpact, allSeams };
  }
  function dij(src, verts) {
    const n = verts.length, d = new Array(n).fill(Infinity), done = new Array(n).fill(false);
    d[src] = 0;
    for (;;) {
      let u = -1, b = Infinity;
      for (let k = 0; k < n; k++) if (!done[k] && d[k] < b) { b = d[k]; u = k; }
      if (u < 0) break;
      done[u] = true;
      for (const e of verts[u].adj) { const v = e.va === u ? e.vb : e.va; if (d[u] + e.L < d[v]) d[v] = d[u] + e.L; }
    }
    return d;
  }

  // ---------- textures (rebuilt on resize)
  let W = 0, H = 0, DPR = 1, CX = 0, CY = 0, S = 1, GS = 1, PPU = 1;
  let texMini = [], texN = null, texH = null, texG = null, texGs = null, bgC = null, maskC = null, mctx = null, texScale = 0;
  function makeSprite(sh, tex) {
    const pad = 3, bw = (sh.bx1 - sh.bx0) * S + pad * 2, bh = (sh.by1 - sh.by0) * S + pad * 2;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(bw * DPR)); c.height = Math.max(1, Math.ceil(bh * DPR));
    const g = c.getContext("2d"), k = S * DPR;
    g.setTransform(k, 0, 0, k, (pad - sh.bx0 * S) * DPR, (pad - sh.by0 * S) * DPR);
    g.save(); g.clip(sh.path);
    g.drawImage(tex, TX.x0, TX.y0, TX.w, TX.h);
    g.globalCompositeOperation = "source-atop";
    g.lineJoin = "round";
    g.lineWidth = 3 / S; g.strokeStyle = "rgba(24,2,10,.55)"; g.stroke(sh.path);
    g.lineWidth = 1.2 / S; g.strokeStyle = "rgba(255,226,234,.3)"; g.stroke(sh.path);
    g.restore();
    return { c, w: bw, h: bh, pad };
  }
  function makeTextures() {
    if (!W) return;
    const want = Math.round(S * DPR);
    if (want !== texScale) {
      texScale = want; PPU = S * DPR;
      texN = renderTex(0, PPU); texH = renderTex(1, PPU); texG = renderTex(2, PPU);
      texGs = renderTex(2, Math.max(40, GS * DPR * 1.25));
      const pm = Math.max(30, S * 0.19 * DPR * 1.3); texMini = [renderTex(0, pm), renderTex(2, pm), renderTex(3, pm)];
      maskC = document.createElement("canvas"); maskC.width = texN.width; maskC.height = texN.height; mctx = maskC.getContext("2d");
    }
    if (GEO) for (const s of GEO.shards) if (!s.dummy) { s.spN = makeSprite(s, texN); s.spH = makeSprite(s, texH); }
    uwC = document.createElement("canvas"); uwC.width = Math.round(W * DPR); uwC.height = Math.round(H * DPR); uctx = uwC.getContext("2d");
    bgC = document.createElement("canvas"); bgC.width = Math.round(W * DPR); bgC.height = Math.round(H * DPR);
    const b = bgC.getContext("2d"); b.scale(DPR, DPR);
    b.fillStyle = "#0b0609"; b.fillRect(0, 0, W, H);
    const v = b.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.6)");
    b.fillStyle = v; b.fillRect(0, 0, W, H);
  }

  // ---------- state
  let seedBase = (Math.random() * 1e9) | 0;
  let GEO = null, now = 0, phase = "intro", events = [], evi = 0;
  let projs = [], parts = [], flashes = [], bruises = [];
  let hits = 0, hurtShown = 0, kick = 0, kdx = 0, kdy = 0, shake = 0, beatPh = 0, beatAmp = 0;
  let shatterAt = -1, ghAt = -1, gh = null, homeCount = 0, nReal = 0;
  let waves = [], infT0 = -1, lastMeet = -1, lastBeat = 0, minis = [], lastMini = 0, lastBud = 0, floodT = -1, fullT = -1, nudge = null, meltT = -1, poolT = -1, lastInteract = -1, lastAuto = 0, interacted = false, grabbed = null;
  let finaleAt = -1, mergeT = -1, goldT = -1, riseT = -1, endShown = false, restore = 0, gold = 0;
  let doneSeams = new Path2D(), doneCount = -1;
  // golden water: wl is the resting surface (px), L0 where it settles, HY the heart's current centre
  let L0 = 0, HYu = 0, HY = 0, wl = 1e5, wAg = 0, ripples = [];
  const ptr = { x: 0, y: 0, vx: 0, vy: 0, t: 0, down: false };
  const HIT_R = [0.26, 0.3, 0.34, 0.4, 0.46];
  const motes = [], bubbles = [];
  for (let k = 0; k < 46; k++) motes.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.4, v: 0.004 + Math.random() * 0.012, a: 0.05 + Math.random() * 0.12, ph: Math.random() * 6.28 });
  for (let k = 0; k < 28; k++) bubbles.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.6, v: 18 + Math.random() * 40, ph: Math.random() * 6.28 });

  function reset() {
    seedBase = (Math.imul(seedBase, 1664525) + 1013904223) >>> 0;
    GEO = build(seedBase);
    nReal = GEO.shards.filter((s) => !s.dummy).length;
    makeTextures();
    now = 0; phase = "intro"; projs = []; parts = []; flashes = []; bruises = [];
    hits = 0; hurtShown = 0; kick = 0; shake = 0; beatPh = 0; beatAmp = 0.032;
    shatterAt = -1; ghAt = -1; gh = null; homeCount = 0;
    meltT = -1; poolT = -1; lastInteract = -1; lastAuto = 0; interacted = false; grabbed = null;
    finaleAt = -1; mergeT = -1; goldT = -1; riseT = -1; endShown = false; restore = 0; gold = 0;
    doneSeams = new Path2D(); doneCount = -1;
    HY = CY; wl = 1e5; wAg = 0; ripples = [];
    clearTimeout(endTimer);
    againBtn.classList.remove("on"); nudge = null; minis = []; lastMini = 0; lastBud = 0; floodT = -1; fullT = -1; waves = []; infT0 = -1; lastMeet = -1; lastBeat = 0;
    const HT = [2.9, 4.3, 5.6, 6.7, 7.6];
    events = [
      { t: 8.6, f: () => launch(5, true) },
    ].concat(HT.map((t, k) => ({ t, f: () => launch(k, false) })));
    events.sort((a, b) => a.t - b.t);
    evi = 0;
  }

  function launch(k, final) {
    const v = final ? GEO.finalImpact : GEO.impacts[k % GEO.impacts.length];
    const a = final ? -Math.PI / 2 + (Math.random() - 0.5) * 0.7 : Math.atan2(v.y + 0.05, v.x) + (Math.random() - 0.5) * 1.1;
    const tx = CX + v.x * S, ty = CY + v.y * S, D = Math.max(W, H) * 0.85;
    projs.push({ t0: now, dur: final ? 0.46 : 0.38, fx: tx + Math.cos(a) * D, fy: ty + Math.sin(a) * D, v, final, k });
  }

  function impact(p) {
    const v = p.v, ix = CX + v.x * S, iy = CY + v.y * S;
    const dx = ix - p.fx, dy = iy - p.fy, dl = Math.hypot(dx, dy) || 1;
    hits++; kick = 1; kdx = dx / dl; kdy = dy / dl;
    if (hits === 1) for (const m of minis) if (m.die) m.die = Math.min(m.die, now + 0.5);
    if (!RM) shake = p.final ? 14 : 7;
    flashes.push({ x: ix, y: iy, t: now, r: S * (p.final ? 0.75 : 0.36), d: p.final ? 0.6 : 0.4, sp: GLOW_W });
    const n = p.final ? 26 : 12, back = Math.atan2(-dy, -dx);
    for (let q = 0; q < n; q++) {
      const an = back + (Math.random() - 0.5) * 2.4, sp = (90 + Math.random() * 260) * (S / 250);
      parts.push({ k: "chip", x: ix, y: iy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, s: (1.4 + Math.random() * 2.6) * (S / 250), life: 0, max: 0.7 + Math.random() * 0.7, c: Math.random() < 0.5 ? "#d8406a" : "#5c0d24" });
    }
    bruises.push({ x: v.x, y: v.y, t: now });
    const d = dij(v.id, GEO.verts), R = p.final ? 99 : HIT_R[p.k], sp = p.final ? 3.0 : 1.1;
    for (const e of GEO.edges) {
      if (e.crackAt != null) continue;
      const da = d[e.va], db = d[e.vb], s = Math.min(da, db);
      if (s <= R) { e.crackAt = now + s / sp; e.crackRev = db < da; e.crackDur = e.L / sp; }
    }
    if (p.final) shatterAt = now + (RM ? 0.25 : 0.6);
  }

  function shatter() {
    phase = "broken";
    // the pieces settle in a loose, wider heart above where the water will be
    const top = H * 0.09, bot = L0 - H * 0.03, cyu = ((top + bot) / 2 - CY) / S;
    const aw = (W * 0.43) / S, ah = (bot - top) / 2 / S;
    const kx = clamp((aw * 0.9) / 0.54, 1.3, 2.6), ky = clamp((ah * 0.9) / 0.5, 1.3, 2.4);
    for (const s of GEO.shards) {
      if (s.dummy) continue;
      let tx = s.px * kx + (Math.random() - 0.5) * 0.16, ty = cyu + s.py * ky + (Math.random() - 0.5) * 0.14;
      const m = s.rad * 0.85;
      tx = clamp(tx, -aw + m, aw - m); ty = clamp(ty, (top - CY) / S + m, (bot - CY) / S - m);
      s.tx = tx - s.px; s.ty = ty - s.py;
      const dx = s.px, dy = s.py + 0.05, dl = Math.hypot(dx, dy) || 1, sp = 1.1 + Math.random() * 1.1;
      s.vx = (dx / dl) * sp; s.vy = (dy / dl) * sp - 0.2; s.ox = 0; s.oy = 0;
      s.r = 0; s.vr = (Math.random() - 0.5) * 5; s.tr = (Math.random() - 0.5) * 1.6;
      s.state = "float"; s.hurt = Math.max(hurtShown, 0.85); s.ph = Math.random() * 6.28; s.sc = 1;
    }
    flashes.push({ x: CX, y: CY, t: now, r: S * 1.2, d: 0.9, sp: GLOW_W });
    for (let q = 0; q < 50; q++) {
      const an = Math.random() * 6.28, sp = (120 + Math.random() * 340) * (S / 250);
      parts.push({ k: "chip", x: CX + (Math.random() - 0.5) * S * 0.6, y: CY + (Math.random() - 0.5) * S * 0.5, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, s: (1.2 + Math.random() * 2.8) * (S / 250), life: 0, max: 0.9 + Math.random() * 0.9, c: Math.random() < 0.5 ? "#d8406a" : "#6a1230" });
    }
    if (!RM) shake = 18;
   
    ghAt = now + (RM ? 1.6 : 2.8);
  }

  // ---------- the water surface
  function surf(x) {
    if (wl > H + 60) return wl;
    const A = 2.4 + 6 * wAg;
    const up = meltT >= 0 && now - meltT < 3.2 ? Math.sin(Math.PI * Math.min(1, (now - meltT) / 3.2)) * 16 * Math.exp(-(((x - CX) / 80) ** 2)) : 0;
    let y = wl - up + A * (Math.sin(x * 0.018 + now * 1.6) * 0.55 + Math.sin(x * 0.043 - now * 2.2) * 0.25 + Math.sin(x * 0.007 + now * 0.6) * 0.45);
    for (const r of ripples) {
      const age = now - r.t, d = Math.abs(x - r.x), front = age * 150;
      y += r.a * Math.exp(-age * 1.6) * Math.exp(-(((d - front) / 70) ** 2)) * Math.sin(d * 0.08 - age * 9);
    }
    return y;
  }
  function ripple(x, a) { ripples.push({ x, t: now, a }); if (ripples.length > 10) ripples.shift(); }
  function splash(x, power) {
    const y = surf(x);
    ripple(x, clamp(3 + power * 4, 3, 14)); wAg = Math.min(1, wAg + 0.12 + power * 0.08);
    const n = Math.round(6 + power * 6);
    for (let q = 0; q < n; q++) {
      const an = -Math.PI / 2 + (Math.random() - 0.5) * 1.4, sp = (120 + Math.random() * 200 * (0.6 + power * 0.4)) * (S / 250);
      parts.push({ k: "drop", x: x + (Math.random() - 0.5) * 10, y: y - 2, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 0, max: 2, s: (1.6 + Math.random() * 2) * (S / 250) });
    }
    for (let q = 0; q < 8; q++) parts.push({ k: "bub", x: x + (Math.random() - 0.5) * 30, y: y + 10 + Math.random() * 40, vx: 0, vy: -(30 + Math.random() * 60), life: 0, max: 0.8 + Math.random() * 0.8, s: 1.2 + Math.random() * 2.4, ph: Math.random() * 6 });
  }

  function shardWorld(s) {
    const bob = s.state === "float" ? Math.sin(now * 0.9 + s.ph) * 0.012 : 0;
    return [CX + (s.px + s.ox) * S, HY + (s.py + s.oy + bob) * S];
  }
  function spark(x, y, n, spd) {
    for (let q = 0; q < n; q++) {
      const an = Math.random() * 6.28, sp = (20 + Math.random() * spd) * (S / 250);
      parts.push({ k: "spark", x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 10, life: 0, max: 0.6 + Math.random() * 0.9, s: (1.6 + Math.random() * 2.4) * (S / 250) });
    }
  }
  function seamTimes(e) {
    const A = GEO.shards[e.i], B = GEO.shards[e.j];
    if (A.state !== "home" || B.state !== "home") return null;
    return [Math.max(A.homeAt, B.homeAt) + 0.15, 0.4 + e.L * 1.7];
  }
  const SINK = RM ? 0.9 : 2.2;
  function springO(s, tx, ty, w, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let k = 0; k < n; k++) {
      s.vx += (w * w * (tx - s.ox) - 2 * w * s.vx) * h; s.vy += (w * w * (ty - s.oy) - 2 * w * s.vy) * h;
      s.ox += s.vx * h; s.oy += s.vy * h;
    }
  }
  function enterWater(s) {
    const w = shardWorld(s), spd = Math.hypot(s.vx || 0, s.vy || 0);
    splash(w[0], clamp(spd / 3, 0.3, 1.4));
    s.state = "sink"; s.t0 = now; s.fx = s.ox; s.fy = s.oy; s.fr = s.r; s.sc0 = s.sc;
    const vx = clamp(s.vx || 0, -3, 3), vy = clamp(Math.max(s.vy || 0, 1), 1, 5);
    s.cx = s.fx + vx * 0.16; s.cy = s.fy + vy * 0.16;
    if (s === grabbed) grabbed = null;
  }
  function submerged(s) { if (wl > H) return false; const w = shardWorld(s); return w[1] > surf(w[0]) + 3; }
  function melt() {
    phase = "melt"; meltT = now;
    flashes.push({ x: gh.x, y: gh.y, t: now, r: GS * 4, d: 0.9, sp: GLOW_W });
   
    // move the heart's home under the water; floating pieces keep their place on screen
    const d = (HYu - HY) / S;
    for (const s of GEO.shards) if (!s.dummy) { s.oy -= d; if (s.ty != null) s.ty -= d; }
    HY = HYu;
  }

  function addMini(x, y, big, vx, vy, o) {
    o = o || {};
    if (x == null) {
      for (let k = 0; k < 20; k++) {
        x = Math.random() * W; y = Math.random() * H;
        if (((x - CX) / (S * 0.66)) ** 2 + ((y - CY) / (S * 0.62)) ** 2 > 1) break;
      }
    }
    const r = Math.random(), mat = o.mat != null ? o.mat : r < 0.5 ? 1 : r < 0.8 ? 0 : 2;
    const pair = o.pair != null ? o.pair : !big && Math.random() < 0.35;
    minis.push({ x, y, mat, pair, die: o.die || 0, s: S * (o.sz || (big ? 0.13 + Math.random() * 0.06 : 0.05 + Math.random() * 0.08)), t0: now, ph: Math.random() * 6.28,
      vx: vx || 0, vy0: vy || 0, vy: o.vy || 6 + Math.random() * 14, sw: 0.5 + Math.random() * 0.7, sa: 4 + Math.random() * 10, a: 0.8 + Math.random() * 0.2 });
    const nb = o.die ? 0 : big ? 8 : 3;
    for (let q = 0; q < nb; q++) parts.push({ k: "bub", x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 10, vx: 0, vy: -(30 + Math.random() * 50), life: 0, max: 1 + Math.random(), s: 1 + Math.random() * 2, ph: Math.random() * 6 });
  }
  function drawMinis() {
    const G3 = [GLOW_P, GLOW_G, GLOW_W];
    for (const m of minis) {
      const age = now - m.t0, b = Math.min(1, age / 0.9);
      const back = b < 1 ? 1 + 2.70158 * Math.pow(b - 1, 3) + 1.70158 * Math.pow(b - 1, 2) : 1;
      const sz = m.s * back * (1 + 0.07 * pulse(beatPh));
      if (sz <= 0.5) continue;
      const x = m.x + Math.sin(now * m.sw + m.ph) * m.sa, y = m.y;
      let a = Math.min(1, age / 0.4) * m.a;
      if (m.die) a *= clamp((m.die - now) / 0.9, 0, 1);
      if (a <= 0.01) continue;
      const tilt = Math.sin(now * 0.6 + m.ph) * 0.18;
      if (m.pair) {
        // a rose heart and a gold heart, leaning into each other
        const d = sz * 0.5 * (0.88 + 0.16 * Math.sin(now * 1.2 + m.ph));
        glow(GLOW_G, x, y, sz * 2.1, 0.3 * a);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(tilt * 0.5);
        ctx.save(); ctx.translate(-d, 0); ctx.rotate(0.24); ctx.drawImage(texMini[0], TX.x0 * sz, TX.y0 * sz, TX.w * sz, TX.h * sz); ctx.restore();
        ctx.save(); ctx.translate(d, 0); ctx.rotate(-0.24); ctx.drawImage(texMini[1], TX.x0 * sz, TX.y0 * sz, TX.w * sz, TX.h * sz); ctx.restore();
        ctx.restore();
        continue;
      }
      glow(G3[m.mat], x, y, sz * 1.7, (m.mat === 2 ? 0.22 : 0.32) * a);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(tilt);
      ctx.drawImage(texMini[m.mat], TX.x0 * sz, TX.y0 * sz, TX.w * sz, TX.h * sz);
      ctx.restore();
    }
  }
  // two little hearts, gold and rose, tracing an endless loop around the big one; they meet in the middle each time round
  const INF_W = (Math.PI * 2) / 7.5;
  function infPos(t, side) {
    const A = Math.min(W * 0.45, S * 1.05), sn = Math.sin(t), d = 1 + sn * sn;
    return [CX + (side * A * Math.cos(t)) / d, HY + 0.02 * S + (1.5 * A * sn * Math.cos(t)) / d];
  }
  function kiss() {
    spark(CX, HY + 0.02 * S, 18, 110);
    flashes.push({ x: CX, y: HY + 0.02 * S, t: now, r: S * 0.3, d: 0.8, sp: GLOW_W });
    addMini(CX, HY - S * 0.04, false, 0, -24, { pair: true, die: now + 7, vy: 20, sz: 0.07 });
    waves.push(now);
  }
  function drawLove() {
    if (waves.length) {
      // each beat sends a soft heart of light outward
      ctx.save(); ctx.translate(CX, HY); ctx.globalCompositeOperation = "lighter";
      for (const t of waves) {
        const e = (now - t) / 2.4;
        if (e < 0 || e >= 1) continue;
        const sc = S * (1.03 + e * 1.4);
        ctx.save(); ctx.scale(sc, sc);
        ctx.lineWidth = (3.2 * (1 - e) + 0.6) / sc; ctx.strokeStyle = `rgba(255,214,140,${0.5 * (1 - e) * (1 - e)})`;
        ctx.stroke(heartPath); ctx.restore();
      }
      ctx.restore();
    }
    if (infT0 >= 0 && now > infT0) {
      const fa = smooth(0, 1.6, now - infT0), t0 = (now - infT0) * INF_W;
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      for (const [side, col] of [[1, "255,214,130"], [-1, "255,130,170"]]) {
        let prev = infPos(t0, side);
        for (let k = 1; k <= 34; k++) {
          const q = infPos(t0 - k * 0.035, side);
          ctx.strokeStyle = `rgba(${col},${fa * 0.55 * (1 - k / 34)})`; ctx.lineWidth = 2.6 * (1 - k / 38);
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); prev = q;
        }
      }
      ctx.restore();
      const sz = S * 0.1 * (1 + 0.08 * pulse(beatPh));
      for (const [side, mat, gsp] of [[1, 1, GLOW_G], [-1, 0, GLOW_P]]) {
        const p = infPos(t0, side);
        glow(GLOW_D, p[0] + 1, p[1] + 3, sz * 1.1, 0.55 * fa);
        glow(gsp, p[0], p[1], sz * 1.9, 0.45 * fa);
        ctx.globalAlpha = fa; ctx.drawImage(texMini[mat], p[0] + TX.x0 * sz, p[1] + TX.y0 * sz, TX.w * sz, TX.h * sz); ctx.globalAlpha = 1;
      }
    }
  }
  function heartRing(x, y, r) { ctx.save(); ctx.translate(x, y); ctx.scale(r * 2.6, r * 2.6); ctx.lineWidth = 1 / (r * 2.6); ctx.stroke(heartPath); ctx.restore(); }

  // ---------- step
  function step(dt) {
    now += dt;
    while (evi < events.length && events[evi].t <= now) events[evi++].f();
    const want = phase === "intro" ? 0.032 * Math.max(0.25, 1 - hits * 0.15) : mergeT >= 0 ? 0.03 * Math.max(restore, gold) : 0;
    beatAmp += (want - beatAmp) * (1 - Math.exp(-dt * 3));
    beatPh += dt / (mergeT >= 0 ? 1.0 : 1.05 + hits * 0.12);
    kick *= Math.exp(-dt * 7);
    shake *= Math.exp(-dt * 7);
    wAg *= Math.exp(-dt * 0.7);
    hurtShown += (Math.min(1, hits / 6) - hurtShown) * (1 - Math.exp(-dt * 3));

    for (let i = projs.length - 1; i >= 0; i--) if (now >= projs[i].t0 + projs[i].dur) { const p = projs[i]; projs.splice(i, 1); impact(p); }
    if (shatterAt > 0 && now >= shatterAt && phase === "intro") shatter();

    if (phase !== "intro") {
      for (const s of GEO.shards) {
        if (s.dummy) continue;
        if (s.state === "float" || s.state === "fall" || s.state === "grab") s.sc += (0.72 - s.sc) * (1 - Math.exp(-dt * 2.5));
        if (s.state === "float") {
          s.vx += (7 * (s.tx - s.ox) - 3.6 * s.vx) * dt; s.vy += (7 * (s.ty - s.oy) - 3.6 * s.vy) * dt;
          s.ox += s.vx * dt; s.oy += s.vy * dt;
          s.vr += (4 * (s.tr - s.r) - 2.6 * s.vr) * dt; s.r += s.vr * dt;
          if (phase !== "broken" && submerged(s)) enterWater(s);
        } else if (s.state === "grab") {
          springO(s, (ptr.x + s.gdx - CX) / S - s.px, (ptr.y + s.gdy - HY) / S - s.py, 16, dt);
          s.r *= Math.exp(-dt * 2);
          if (submerged(s)) enterWater(s);
        } else if (s.state === "fall") {
          s.vy += 5.2 * dt; s.vx *= Math.exp(-dt * 0.5);
          s.ox += s.vx * dt; s.oy += s.vy * dt; s.r += s.vr * dt;
          if (submerged(s)) enterWater(s);
        } else if (s.state === "sink") {
          // slowed by the water, drifting and turning back into place
          const e = clamp((now - s.t0) / SINK, 0, 1), q = 1 - Math.pow(1 - e, 2.6), u = 1 - q;
          const sw = Math.sin(e * Math.PI * 2.5) * 0.025 * (1 - e);
          s.ox = u * u * s.fx + 2 * u * q * s.cx + sw; s.oy = u * u * s.fy + 2 * u * q * s.cy;
          s.r = s.fr * u + Math.sin(e * Math.PI * 2) * 0.14 * (1 - e); s.sc = lerp(s.sc0, 1, smooth(0.2, 1, e));
          if (Math.random() < dt * 5) { const w = shardWorld(s); parts.push({ k: "bub", x: w[0] + (Math.random() - 0.5) * 16, y: w[1], vx: 0, vy: -(30 + Math.random() * 40), life: 0, max: 1 + Math.random(), s: 1 + Math.random() * 1.8, ph: Math.random() * 6 }); }
          if (e >= 1) {
            s.state = "home"; s.homeAt = now; s.ox = s.oy = s.r = 0; s.sc = 1; homeCount++;
            const w = shardWorld(s); spark(w[0], w[1], 10, 90);
            flashes.push({ x: w[0], y: w[1], t: now, r: S * (s.rad + 0.1), d: 0.7, sp: GLOW_G });
            addMini(w[0], w[1], false, (Math.random() - 0.5) * 20, -12, { die: now + 3.6, mat: 1, vy: 26, sz: 0.045, pair: false });
          }
        } else if (s.state === "home") {
          s.hurt += (0.3 - s.hurt) * (1 - Math.exp(-dt * 1.6));
        }
      }
    }

    if (phase === "broken" && ghAt > 0 && now >= ghAt) {
      if (!gh) { gh = { x: CX, y: -GS * 1.5, vx: 0, vy: 0, vis: 0, sc: 1 }; }
      spring(gh, CX, HYu, 2.1, dt);
      gh.vis = Math.min(1, gh.vis + dt * 0.9);
      if (Math.hypot(gh.x - CX, gh.y - HYu) < 6 || now > ghAt + 3.8) melt();
    }
    if (phase === "melt") {
      spring(gh, CX, HYu, 3, dt);
      if (Math.random() < dt * 40) parts.push({ k: "bub", x: CX + (Math.random() - 0.5) * S * 0.5, y: H - 4, vx: 0, vy: -(60 + Math.random() * 90), life: 0, max: 2.5, s: 1.2 + Math.random() * 2.6, ph: Math.random() * 6 });
      const e = clamp((now - meltT) / 2.2, 0, 1);
      wl = lerp(H + 40, L0, easeOut(e));
      wAg = Math.max(wAg, 0.6 * (1 - e));
      if (e >= 1) { phase = "pool"; poolT = now; lastInteract = now; }
    }
    nudge = null;
    if (phase === "pool") {
      if (!interacted && homeCount === 0 && now - poolT > 0.8) { let by = -1e9; for (const s of GEO.shards) if (!s.dummy && s.state === "float") { const w = shardWorld(s); if (w[1] > by) { by = w[1]; nudge = s; } } }
      const idle = now - lastInteract > (interacted ? 2.6 : RM ? 0.6 : 3.6);
      if (idle && !grabbed && now - lastAuto > (RM ? 0.25 : 0.6)) {
        // the water calls the lowest piece down by itself
        let best = null, by = -1e9;
        for (const s of GEO.shards) if (!s.dummy && s.state === "float") { const w = shardWorld(s); if (w[1] > by) { by = w[1]; best = s; } }
        if (best) { best.state = "fall"; best.vx = (Math.random() - 0.5) * 0.4; best.vy = 0.3; best.vr = (Math.random() - 0.5) * 2; lastAuto = now; }
      }
      if (homeCount === nReal) {
        phase = "mend";
        let end = now;
        for (const e of GEO.edges) { const t = seamTimes(e); if (t) end = Math.max(end, t[0] + t[1]); }
        finaleAt = end + 0.6;
      }
    }
    if (phase === "mend" && now >= finaleAt) {
      phase = "finale"; mergeT = now;
      flashes.push({ x: CX, y: HY, t: now, r: S * 1.1, d: 1.2, sp: GLOW_G });
      spark(CX, HY, 30, 200);
    }
    if (phase === "finale" || phase === "rise") {
      restore = smooth(0, 1.4, now - mergeT);
      if (gh) { const e = clamp((now - mergeT) / 1.0, 0, 1); gh.sc = 1 + 0.9 * easeOut(e); gh.vis = 1 - e; if (e >= 1) gh = null; }
      if (goldT < 0 && now - mergeT > 2.2) { goldT = now; }
      if (goldT >= 0) {
        const g0 = gold;
        gold = smooth(0, RM ? 1.2 : 3.4, now - goldT);
        if (gold > 0.98 && g0 <= 0.98) { flashes.push({ x: CX, y: HY, t: now, r: S * 1.3, d: 1.4, sp: GLOW_G }); spark(CX, HY, 36, 220); }
        if (phase === "finale" && now - goldT > (RM ? 1.6 : 4.0)) { phase = "rise"; riseT = now; }
      }
    }
    if (phase === "rise") {
      // the gold heart floats up to the middle while the spring keeps rising until it fills the whole screen
      const e1 = clamp((now - riseT) / (RM ? 1.5 : 3.8), 0, 1), e2 = clamp((now - riseT - 0.3) / (RM ? 1.5 : 4.2), 0, 1);
      HY = lerp(HYu, CY, easeIO(e1));
      wl = lerp(L0, -70, e2 * e2 * (3 - 2 * e2));
      wAg = Math.max(wAg, 0.25 * (1 - e2));
      if (e1 >= 1 && e2 >= 1) { phase = "full"; fullT = now; infT0 = now + 0.5; }
    }
    if (phase === "rise" || phase === "full") {
      if (wl < CY && minis.length < 40 && now - lastMini > (RM ? 0.6 : 0.34)) { addMini(); lastMini = now; }
      if (phase === "full" && now - lastBud > 1.6) {
        // now and then a tiny heart buds from the golden one and drifts away
        lastBud = now;
        const a = Math.random() * 6.28;
        addMini(CX + Math.cos(a) * S * 0.42, HY + Math.sin(a) * S * 0.36 - S * 0.04, false, Math.cos(a) * 22, Math.sin(a) * 18);
      }

      if (phase === "full" && !endShown && now - fullT > 4) {
        endShown = true;
        endTimer = setTimeout(() => { if (!dead) againBtn.classList.add("on"); }, 800);
      }
    }
    if (gold > 0.95 && Math.random() < dt * 2.2) {
      const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * 0.36;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.9 - 0.04;
      if (pip(HP, x, y)) parts.push({ k: "twinkle", x: CX + x * S, y: HY + y * S, life: 0, max: 0.9, s: (5 + Math.random() * 6) * (S / 250) });
    }

    for (let i = minis.length - 1; i >= 0; i--) {
      const m = minis[i];
      if (m.die && now > m.die) { minis.splice(i, 1); continue; }
      m.vx *= Math.exp(-dt * 0.5); m.x += m.vx * dt; m.y += (m.vy0 - m.vy) * dt; m.vy0 *= Math.exp(-dt * 0.8);
      if (m.y < -m.s * 1.6) { if (m.die) { minis.splice(i, 1); continue; } m.y = H + m.s * 1.2; m.x = Math.random() * W; m.vx = 0; m.vy0 = 0; }
    }
    if (minis.length > 70) minis.splice(0, minis.length - 70);
    // love, without words: little hearts rise from the happy heart until the first blow; the healed heart pulses light
    if (phase === "intro" && hits === 0 && now > 1.0 && now - lastMini > 0.3) {
      lastMini = now; const a = (Math.random() - 0.5) * 1.3;
      addMini(CX + Math.sin(a) * S * 0.36, CY - S * 0.44, false, Math.sin(a) * 18, 0, { die: now + 3.4, mat: Math.random() < 0.75 ? 0 : 2, vy: 26 + Math.random() * 16, sz: 0.05 + Math.random() * 0.05, pair: Math.random() < 0.2 });
    }
    const bi = Math.floor(beatPh);
    if (bi !== lastBeat) { lastBeat = bi; if (phase === "full" || (phase === "rise" && gold > 0.99)) waves.push(now); }
    if (waves.length && now - waves[0] > 2.5) waves.shift();
    if (phase === "full" && infT0 >= 0 && now > infT0) {
      const mt = Math.floor(((now - infT0) * INF_W - Math.PI / 2) / Math.PI);
      if (mt !== lastMeet) { if (mt >= 0) kiss(); lastMeet = mt; }
    }
    for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t > 3) ripples.splice(i, 1);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      if (p.k === "chip") { p.vy += 480 * (S / 250) * dt; p.vx *= Math.exp(-dt * 1.2); p.r += p.vr * dt; }
      else if (p.k === "spark") { p.vx *= Math.exp(-dt * 2.2); p.vy = p.vy * Math.exp(-dt * 2.2) - 8 * dt; }
      else if (p.k === "drop") {
        p.vy += 900 * (S / 250) * dt;
        if (p.vy > 0 && wl < H + 20 && p.y > surf(p.x)) { if (Math.random() < 0.5) ripple(p.x, 1.6); parts.splice(i, 1); continue; }
      } else if (p.k === "bub") { p.x += Math.sin(now * 6 + p.ph) * 0.4; if (p.y < surf(p.x) + 2) { parts.splice(i, 1); continue; } }
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    for (const m of motes) { m.y -= m.v * dt; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); } }
    if (wl < H) for (const b of bubbles) { b.y -= (b.v * dt) / Math.max(80, H - wl); if (b.y < 0) { b.y = 1; b.x = Math.random(); } }
  }

  // ---------- draw
  function drawBg() {
    ctx.drawImage(bgC, 0, 0, W, H);
    const R = Math.max(W, H) * 0.7;
    if (phase === "intro") glow(GLOW_R, CX, CY, R, 0.55 * (1 - hurtShown * 0.7) * Math.min(1, now / 1.2));
    const ga = 0.5 * Math.max(restore * 0.6, gold) + (gh ? 0.12 * gh.vis : 0);
    glow(GLOW_G, CX, HY, R * (0.75 + 0.05 * pulse(beatPh) * gold), ga);
    const warm = phase !== "intro" && phase !== "broken";
    for (const m of motes) {
      const a = m.a * (0.6 + 0.4 * Math.sin(now * 0.7 + m.ph));
      ctx.fillStyle = warm ? `rgba(255,214,140,${a})` : `rgba(255,200,215,${a * 0.8})`;
      ctx.fillRect(m.x * W, m.y * H, m.s, m.s);
    }
  }

  function heartImg(tex) { ctx.drawImage(tex, TX.x0 * S, TX.y0 * S, TX.w * S, TX.h * S); }

  function drawIntact() {
    const intro = easeOut(Math.min(1, now / 1.2));
    const b = (0.94 + 0.06 * intro) * (1 + beatAmp * pulse(beatPh) - 0.045 * kick);
    ctx.save();
    ctx.translate(CX + kdx * 6 * kick, CY + kdy * 6 * kick); ctx.scale(b, b);
    ctx.globalCompositeOperation = "lighter"; glow(GLOW_P, 0, 0, S * 0.95, 0.42 * (1 - hurtShown * 0.8) * intro); ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = intro;
    heartImg(texN);
    if (hurtShown > 0.01) { ctx.globalAlpha = hurtShown * intro; heartImg(texH); }
    ctx.globalAlpha = 1;
    for (const z of bruises) glow(GLOW_D, z.x * S, z.y * S, 0.075 * S, Math.min(1, (now - z.t) / 0.3) * 0.75);
    ctx.scale(S, S);
    ctx.save(); ctx.clip(heartPath);
    const P = new Path2D();
    let any = false;
    for (const e of GEO.edges) {
      if (e.crackAt == null || now < e.crackAt) continue;
      const p = clamp((now - e.crackAt) / e.crackDur, 0, 1);
      if (p >= 1) P.addPath(e.full);
      else if (e.crackRev) rangePath(P, e, e.L * (1 - p), e.L);
      else rangePath(P, e, 0, e.L * p);
      any = true;
    }
    if (any) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(16,1,6,.88)"; ctx.lineWidth = 2.4 / S; ctx.stroke(P);
      ctx.translate(0.9 / S, 0.9 / S);
      ctx.strokeStyle = "rgba(255,200,214,.32)"; ctx.lineWidth = 0.9 / S; ctx.stroke(P);
    }
    ctx.restore(); ctx.restore();
  }

  function drawShard(s) {
    const w = shardWorld(s), sp = s.spN;
    const r = s.r + (s.state === "float" ? Math.sin(now * 0.5 + s.ph) * 0.06 : 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(shx, shy);
    if (s.state === "grab") glow(GLOW_G, w[0], w[1], S * (s.rad + 0.12), 0.5);
    if (s === nudge) glow(GLOW_W, w[0], w[1], S * (s.rad + 0.1), 0.18 + 0.16 * Math.sin(now * 3.2));
    ctx.translate(w[0], w[1]); if (r) ctx.rotate(r); if (s.sc && s.sc !== 1) ctx.scale(s.sc, s.sc);
    const x = (s.bx0 - s.px) * S - sp.pad, y = (s.by0 - s.py) * S - sp.pad;
    ctx.drawImage(sp.c, x, y, sp.w, sp.h);
    if (s.hurt > 0.01) { ctx.globalAlpha = Math.min(1, s.hurt); ctx.drawImage(s.spH.c, x, y, sp.w, sp.h); ctx.globalAlpha = 1; }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(shx, shy);
  }

  // gold seams; finished seams are cached in one path so a frame only builds the ones still flowing
  function drawSeams(k, alpha) {
    const P = new Path2D(), heads = [];
    let cnt = 0, live = false;
    for (const e of GEO.edges) {
      const t = seamTimes(e);
      if (!t) continue;
      const p = (now - t[0]) / t[1];
      if (p <= 0) continue;
      if (p >= 1) { cnt++; continue; }
      const q = easeOut(p), a = (e.L / 2) * (1 - q), b = (e.L / 2) * (1 + q);
      rangePath(P, e, a, b); live = true;
      heads.push(pointAt(e, a), pointAt(e, b));
    }
    if (cnt !== doneCount) {
      doneCount = cnt; doneSeams = new Path2D();
      for (const e of GEO.edges) { const t = seamTimes(e); if (t && now >= t[0] + t[1]) doneSeams.addPath(e.full); }
    }
    if (!cnt && !live) return;
    if (live) P.addPath(doneSeams);
    const path = live ? P : doneSeams;
    ctx.save(); ctx.clip(heartPath);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255,185,70,.22)"; ctx.lineWidth = (8 / S) * k; ctx.stroke(path);
    ctx.strokeStyle = "#cf9734"; ctx.lineWidth = (3.6 / S) * k; ctx.stroke(path);
    ctx.strokeStyle = "#ffe8a6"; ctx.lineWidth = (1.3 / S) * k; ctx.stroke(path);
    ctx.globalAlpha = 1;
    for (const h of heads) glow(GLOW_W, h[0], h[1], 10 / S, 0.9);
    ctx.restore();
  }

  function drawGoldSpread(g) {
    // gold seeping outward from every seam until it covers each piece
    if (g >= 0.999) { heartImg(texG); return; }
    const k = PPU, wdt = lerp(0.004, 0.62, g * g * (3 - 2 * g));
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, maskC.width, maskC.height);
    mctx.setTransform(k, 0, 0, k, -TX.x0 * k, -TX.y0 * k);
    mctx.lineCap = "round"; mctx.lineJoin = "round";
    mctx.strokeStyle = "rgba(0,0,0,.28)"; mctx.lineWidth = wdt * 1.5 + 0.02; mctx.stroke(GEO.allSeams);
    mctx.strokeStyle = "rgba(0,0,0,.45)"; mctx.lineWidth = wdt * 1.22 + 0.01; mctx.stroke(GEO.allSeams);
    mctx.strokeStyle = "#000"; mctx.lineWidth = wdt; mctx.stroke(GEO.allSeams);
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalCompositeOperation = "source-in";
    mctx.drawImage(texG, 0, 0);
    mctx.globalCompositeOperation = "source-over";
    heartImg(maskC);
    const f = smooth(0.7, 1, g);
    if (f > 0) { ctx.globalAlpha = f; heartImg(texG); ctx.globalAlpha = 1; }
  }

  function drawWhole() {
    const b = 1 + beatAmp * pulse(beatPh);
    ctx.save(); ctx.translate(CX, HY); ctx.scale(b, b);
    if (gold < 0.999) {
      heartImg(texN);
      const h = 0.3 * (1 - restore);
      if (h > 0.01) { ctx.globalAlpha = h; heartImg(texH); ctx.globalAlpha = 1; }
    }
    if (gold > 0) drawGoldSpread(gold);
    ctx.scale(S, S);
    drawSeams(1 + 0.2 * restore, 1 - 0.72 * gold);
    if (mergeT >= 0 && now - mergeT < 1.4) {
      const r = ((now - mergeT) / 1.4) * 0.85, a = 1 - (now - mergeT) / 1.4;
      ctx.save(); ctx.clip(heartPath); ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(0, 0, Math.max(0, r - 0.1), 0, 0, r + 0.08);
      g.addColorStop(0, "rgba(255,200,100,0)"); g.addColorStop(0.55, `rgba(255,210,120,${0.45 * a})`); g.addColorStop(1, "rgba(255,200,100,0)");
      ctx.fillStyle = g; ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
      ctx.restore();
    }
    if (gold > 0.6) {
      const u = (((now - goldT) % 3.8) / 3.8) * 2.6 - 1.3, a = smooth(0.6, 1, gold) * 0.42;
      ctx.save(); ctx.clip(heartPath); ctx.globalCompositeOperation = "lighter";
      const g = ctx.createLinearGradient(u - 0.18, u - 0.18, u + 0.18, u + 0.18);
      g.addColorStop(0, "rgba(255,240,200,0)"); g.addColorStop(0.5, `rgba(255,244,214,${a})`); g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g; ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------- golden water: clear champagne gold, caustic light, wavering refraction, drifting gold leaf
  const CAU = (function () {
    // a tileable caustic net: bright where two Worley cells meet
    const N = 256, c = document.createElement("canvas"); c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N), D = img.data, R = rng(77), pts = [];
    for (let k = 0; k < 22; k++) pts.push([R() * N, R() * N]);
    const TAU = Math.PI * 2;
    for (let y0 = 0; y0 < N; y0++) for (let x0 = 0; x0 < N; x0++) {
      // warp the lookup with tileable sines so the net comes out curved, like light through ripples
      const x = x0 + 9 * Math.sin((y0 / N) * TAU * 2 + 1.3) + 5 * Math.sin((x0 / N + y0 / N) * TAU * 3);
      const y = y0 + 9 * Math.sin((x0 / N) * TAU * 2 + 0.4) + 5 * Math.sin((x0 / N - y0 / N) * TAU * 3);
      let f1 = 1e9, f2 = 1e9;
      for (const p of pts) for (let oy = -N; oy <= N; oy += N) for (let ox = -N; ox <= N; ox += N) {
        const dx = x - p[0] - ox, dy = y - p[1] - oy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const v = Math.pow(clamp(1 - (f2 - f1) / 10, 0, 1), 2.4) * (0.55 + 0.45 * Math.sin(f1 * 0.15));
      const o = (y0 * N + x0) * 4; D[o] = 222; D[o + 1] = 252; D[o + 2] = 255; D[o + 3] = v * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  })();
  let cauPat = null;
  const flakes = [];
  for (let k = 0; k < 44; k++) flakes.push({ x: Math.random(), y: Math.random(), s: 1.2 + Math.random() * 2.4, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.2, dr: (Math.random() - 0.5) * 0.01 });
  let uwC = null, uctx = null;

  function waterPaths() {
    const step = 6, P = new Path2D(), Sf = new Path2D();
    P.moveTo(-10, H + 10);
    for (let x = -10; x <= W + 10; x += step) { const y = surf(x); P.lineTo(x, y); x === -10 ? Sf.moveTo(x, y) : Sf.lineTo(x, y); }
    P.lineTo(W + 10, H + 10); P.closePath();
    return [P, Sf];
  }

  // draw the underwater layer with a gentle sideways shimmer, strip by strip, below the surface only
  function compositeUnder() {
    const top = Math.max(0, Math.floor(wl - 14));
    if (top > 0) ctx.drawImage(uwC, 0, 0, uwC.width, Math.min(uwC.height, top * DPR), 0, 0, W, Math.min(H, top));
    const st = wl < H * 0.3 ? 4 : 3;
    for (let y = top; y < H; y += st) {
      const depth = smooth(0, 40, y - wl);
      const dx = depth * (Math.sin(y * 0.045 + now * 2.1) * 1.5 + Math.sin(y * 0.11 - now * 3.2) * 0.6);
      ctx.drawImage(uwC, 0, y * DPR, uwC.width, st * DPR, dx, y, W, st);
    }
  }

  function drawWater() {
    if (wl > H + 50) return;
    const [P, Sf] = waterPaths();
    const deep = Math.max(wl + 320, H);
    // Salsabil: a pure, clear spring. Mostly light, a faint cool body so it reads as real water.
    let g = ctx.createLinearGradient(0, wl - 8, 0, deep);
    g.addColorStop(0, "rgba(4,40,56,.10)"); g.addColorStop(1, "rgba(2,30,48,.24)");
    ctx.fillStyle = g; ctx.fill(P);
    ctx.save(); ctx.clip(P);
    ctx.globalCompositeOperation = "lighter";
    g = ctx.createLinearGradient(0, wl - 8, 0, deep);
    g.addColorStop(0, "rgba(150,232,246,.17)"); g.addColorStop(0.35, "rgba(96,206,232,.10)"); g.addColorStop(1, "rgba(60,176,222,.15)");
    ctx.fillStyle = g; ctx.fillRect(0, wl - 20, W, H - wl + 40);
    // the golden heart lights the spring from within
    if (gh && gh.vis > 0) glow(GLOW_G, gh.x, gh.y, S * 1.25, 0.26 * gh.vis * Math.min(1, gh.sc));
    // bright band just under the surface
    g = ctx.createLinearGradient(0, wl - 6, 0, wl + 50);
    g.addColorStop(0, "rgba(235,250,255,.34)"); g.addColorStop(1, "rgba(235,250,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, wl - 20, W, 74);
    // caustics: two nets of light drifting across each other
    if (!cauPat) cauPat = ctx.createPattern(CAU, "repeat");
    const layers = [[now * 13, now * 5, 0.2, 1.2], [-now * 9, now * 8, 0.14, 1.75]];
    for (const [ox, oy, a, sc] of layers) {
      ctx.save(); ctx.globalAlpha = a * lerp(0.65, 1, smooth(-70, H * 0.4, wl)); ctx.scale(sc, sc);
      ctx.translate(((ox % 256) + 256) % 256 - 256, ((oy % 256) + 256) % 256 - 256);
      ctx.fillStyle = cauPat; ctx.fillRect(0, 0, W / sc + 512, H / sc + 512);
      ctx.restore();
    }
    // soft shafts of light from above
    for (let k = 0; k < 5; k++) {
      const x0 = (((k * 0.23 + now * 0.01 * (k % 2 ? 1 : -1)) % 1 + 1) % 1) * W * 1.3 - W * 0.15, bw = 30 + ((k * 37) % 60);
      const fl = 0.6 + 0.4 * Math.sin(now * 0.7 + k * 1.9);
      const lg = ctx.createLinearGradient(0, wl, 0, wl + (H - wl) * 0.85);
      lg.addColorStop(0, `rgba(235,250,255,${0.13 * fl})`); lg.addColorStop(1, "rgba(235,250,255,0)");
      ctx.fillStyle = lg; ctx.beginPath();
      ctx.moveTo(x0, wl - 10); ctx.lineTo(x0 + bw, wl - 10); ctx.lineTo(x0 + bw - 110, H); ctx.lineTo(x0 - 110, H); ctx.closePath(); ctx.fill();
    }
    // tiny motes of light suspended in the water, flashing as they turn
    for (const f of flakes) {
      const x = (((f.x + now * f.dr) % 1) + 1) % 1 * W + Math.sin(now * 0.6 + f.ph) * 10, y = wl + 10 + f.y * (H - wl - 10) + Math.sin(now * 0.45 + f.ph * 2) * 6;
      const turn = Math.cos(now * f.sp + f.ph), a = 0.2 + 0.8 * Math.pow(Math.abs(turn), 6);
      ctx.fillStyle = `rgba(235,248,255,${0.45 * a})`;
      ctx.beginPath(); ctx.ellipse(x, y, f.s * 0.5 * (0.3 + 0.7 * Math.abs(turn)), f.s * 0.5, f.ph, 0, 7); ctx.fill();
      if (a > 0.75) glow(GLOW_W, x, y, f.s * 2.5, 0.3 * a);
    }
    ctx.strokeStyle = "rgba(235,250,255,.5)"; ctx.lineWidth = 0.8;
    for (const b of bubbles) {
      const x = b.x * W + Math.sin(now * 1.3 + b.ph) * 6, y = wl + b.y * (H - wl);
      if (b.ph < 1.9) { heartRing(x, y, b.r * 1.3); continue; }
      ctx.beginPath(); ctx.arc(x, y, b.r, 0, 7); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillRect(x - b.r * 0.4, y - b.r * 0.5, 1, 1);
    }
    ctx.restore();
    // the surface: a faint haze above, a soft glow and a crisp bright edge, glints where the light catches
    ctx.save();
    g = ctx.createLinearGradient(0, wl - 24, 0, wl);
    g.addColorStop(0, "rgba(210,240,255,0)"); g.addColorStop(1, "rgba(210,240,255,.10)");
    ctx.fillStyle = g; ctx.fillRect(0, wl - 24, W, 24);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(150,228,250,.32)"; ctx.lineWidth = 6; ctx.stroke(Sf);
    ctx.strokeStyle = "rgba(250,254,255,.95)"; ctx.lineWidth = 1.4; ctx.stroke(Sf);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 14; k++) {
      const x = (((k * 0.0731 + now * 0.012 * (k % 3 - 1)) % 1 + 1) % 1) * W, a = Math.pow(Math.max(0, Math.sin(x * 0.05 + now * 2.6 + k)), 10);
      if (a > 0.05) glow(GLOW_W, x, surf(x), 7, 0.9 * a);
    }
    ctx.restore();
  }

  function drawGH() {
    if (!gh || gh.vis <= 0.01 || gh.sc <= 0.01) return;
    const sc = GS * gh.sc * (1 + 0.07 * pulse(now * 1.05));
    glow(GLOW_G, gh.x, gh.y, sc * 2.2, 0.55 * gh.vis);
    ctx.globalAlpha = gh.vis;
    ctx.drawImage(texGs, gh.x + TX.x0 * sc, gh.y + TX.y0 * sc, TX.w * sc, TX.h * sc);
    ctx.globalAlpha = 1;
  }

  function drawFx() {
    for (const p of projs) {
      const e = clamp((now - p.t0) / p.dur, 0, 1), q = e * e * (1.6 - 0.6 * e);
      const tx = CX + p.v.x * S, ty = CY + p.v.y * S;
      const x = lerp(p.fx, tx, q), y = lerp(p.fy, ty, q);
      const dx = tx - p.fx, dy = ty - p.fy, dl = Math.hypot(dx, dy) || 1, tl = (p.final ? 150 : 110) * (S / 250);
      const g = ctx.createLinearGradient(x, y, x - (dx / dl) * tl, y - (dy / dl) * tl);
      g.addColorStop(0, "rgba(225,228,255,.95)"); g.addColorStop(1, "rgba(160,170,220,0)");
      ctx.strokeStyle = g; ctx.lineWidth = p.final ? 3.2 : 2.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (dx / dl) * tl, y - (dy / dl) * tl); ctx.stroke();
      glow(GLOW_W, x, y, p.final ? 16 : 12, 0.6);
    }
    for (const p of parts) {
      if (p.k !== "chip") continue;
      const a = 1 - p.life / p.max, c = Math.cos(p.r), s = Math.sin(p.r);
      ctx.globalAlpha = a; ctx.fillStyle = p.c;
      ctx.setTransform(DPR * c, DPR * s, -DPR * s, DPR * c, DPR * (p.x + shx), DPR * (p.y + shy));
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.7);
    }
    ctx.globalAlpha = 1; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(shx, shy);
    for (const p of parts) {
      if (p.k === "drop") {
        ctx.fillStyle = "rgba(236,249,255,.85)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.8, p.s * (1 + Math.min(1, Math.abs(p.vy) / 600)), 0, 0, 7); ctx.fill();
      } else if (p.k === "bub") {
        ctx.strokeStyle = `rgba(235,250,255,${0.65 * (1 - p.life / p.max)})`; ctx.lineWidth = 1;
        if (p.ph < 1.8) heartRing(p.x, p.y, p.s * 1.2); else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.stroke(); }
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      const a = 1 - p.life / p.max;
      if (p.k === "spark") glow(GLOW_G, p.x, p.y, p.s * 2.2 * (0.5 + 0.5 * a), a);
      else if (p.k === "drop") glow(GLOW_W, p.x, p.y, p.s * 3, 0.3);
      else if (p.k === "twinkle") {
        const t = Math.sin(Math.PI * (p.life / p.max)), r = p.s * t;
        ctx.fillStyle = `rgba(255,250,230,${0.9 * t})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * 0.16, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r * 0.16, p.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x, p.y + r * 0.16); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y - r * 0.16); ctx.closePath(); ctx.fill();
        glow(GLOW_W, p.x, p.y, r * 0.8, 0.5 * t);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], e = (now - f.t) / f.d;
      if (e >= 1) { flashes.splice(i, 1); continue; }
      glow(f.sp, f.x, f.y, f.r * (0.6 + 0.6 * easeOut(e)), (1 - e) * (1 - e) * 0.85);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  let shx = 0, shy = 0;
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBg();
    shx = shake > 0.15 ? shake * (Math.sin(now * 57.3) * 0.6 + Math.sin(now * 33.1 + 1.7) * 0.4) : 0;
    shy = shake > 0.15 ? shake * (Math.sin(now * 49.7 + 0.6) * 0.6 + Math.sin(now * 29.3 + 2.9) * 0.4) : 0;
    ctx.translate(shx, shy);
    if (phase === "intro") { if (minis.length) drawMinis(); drawIntact(); }
    else {
      // under the surface: the pieces coming home, then the mended heart. With water, this goes to its own
      // layer first so it can shimmer.
      const wet = wl < H + 40, main = ctx;
      if (wet) { ctx = uctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, uwC.width, uwC.height); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(shx, shy); }
      if (wet && gh && mergeT < 0) drawGH();
      if (minis.length) drawMinis();
      if (homeCount === nReal) drawWhole();
      else {
        for (const s of GEO.shards) if (!s.dummy && s.state === "home") drawShard(s);
        ctx.save(); ctx.translate(CX, HY); ctx.scale(S, S); drawSeams(1, 1); ctx.restore();
        for (const s of GEO.shards) if (!s.dummy && s.state === "sink") drawShard(s);
      }
      if (wet && gh && mergeT >= 0) drawGH();
      if (homeCount === nReal && (waves.length || infT0 >= 0)) drawLove();
      if (wet) { ctx = main; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); compositeUnder(); ctx.translate(shx, shy); }
      drawWater();
      for (const s of GEO.shards) if (!s.dummy && (s.state === "float" || s.state === "fall")) drawShard(s);
      if (grabbed) drawShard(grabbed);
    }
    if (phase === "intro" || wl >= H + 40) drawGH();
    drawFx();
  }

  // ---------- sizing, input, loop
  function resize() {
    const r = cv.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    CX = W / 2; CY = H * 0.45;
    S = Math.min((W * 0.7) / (HB.x1 - HB.x0), H * 0.4);
    GS = S * 0.18;
    L0 = H - S - 60; HYu = H - 0.5 * S - 34;
    if (phase === "intro" || phase === "broken") HY = CY;
    else if (phase === "full") { HY = CY; wl = -70; }
    else if (phase !== "rise") { HY = HYu; if (wl < H) wl = L0; }
    makeTextures();
  }
  function ptrPos(e) { const r = cv.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; }
  function pick(x, y) {
    let best = null, bd = 1e9;
    for (const s of GEO.shards) {
      if (s.dummy || s.state !== "float") continue;
      const w = shardWorld(s), d = Math.hypot(w[0] - x, w[1] - y);
      if (d < Math.max(34, s.rad * S * 1.15) && d < bd) { bd = d; best = s; }
    }
    return best;
  }
  on(cv, "pointerdown", (e) => {
    ptrPos(e); ptr.down = true; ptr.vx = ptr.vy = 0; ptr.t = performance.now();
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    if (phase === "full" || (phase === "rise" && ptr.y > surf(ptr.x))) { addMini(ptr.x, ptr.y, true, 0, 0, { pair: Math.random() < 0.5 }); return; }
    if (phase !== "pool" && phase !== "melt") return;
    const s = pick(ptr.x, ptr.y);
    if (s) {
      const w = shardWorld(s);
      s.state = "grab"; s.gdx = w[0] - ptr.x; s.gdy = w[1] - ptr.y; s.vx = s.vy = 0; grabbed = s;
      interacted = true; lastInteract = now;
    } else if (wl < H && ptr.y > surf(ptr.x)) { ripple(ptr.x, 5); lastInteract = now; }
  });
  on(cv, "pointermove", (e) => {
    if (!ptr.down) return;
    const x0 = ptr.x, y0 = ptr.y, t = performance.now(), d = Math.max(4, t - ptr.t) / 1000;
    ptrPos(e);
    ptr.vx = lerp(ptr.vx, (ptr.x - x0) / d, 0.5); ptr.vy = lerp(ptr.vy, (ptr.y - y0) / d, 0.5); ptr.t = t;
    if (grabbed) lastInteract = now;
  });
  function release() {
    ptr.down = false;
    if (grabbed && grabbed.state === "grab") {
      grabbed.state = "fall";
      grabbed.vx = clamp(ptr.vx / S, -4, 4); grabbed.vy = clamp(ptr.vy / S, -4, 6); grabbed.vr = (Math.random() - 0.5) * 3;
      lastInteract = now;
    }
    grabbed = null;
  }
  on(cv, "pointerup", release);
  on(cv, "pointercancel", release);
  let rzT = 0;
  on(window, "resize", () => { clearTimeout(rzT); rzT = setTimeout(resize, 120); });
  on(againBtn, "click", () => reset());

  let last = performance.now(), sdt = 1 / 60;
  function frame(ts) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const raw = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    last = ts;
    sdt += (raw - sdt) * 0.25; // smooth uneven frame pacing
    step(sdt);
    draw();
  }
  resize();
  reset();
  raf = requestAnimationFrame(frame);


  return function cleanup() {
    dead = true; cancelAnimationFrame(raf); clearTimeout(capTimer); clearTimeout(endTimer); clearTimeout(rzT);
    for (const [el, ev, fn, o] of listeners) el.removeEventListener(ev, fn, o);
  };
}
