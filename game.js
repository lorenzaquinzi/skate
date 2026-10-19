// Skate — a Chrome-dino-style endless runner. A skater rolls along a street, you
// jump the obstacles (bins, cones, benches…), the pace picks up, one hit ends the run.
// Space / ↑ / W / click / tap = jump (hold for a higher one), press again in the air =
// kickflip (+10), ↓ / S = drop faster. Pure line art in the page colours, so it follows
// light / dark. Extracted from the portfolio26 hero (variants.game).

(function () {
  "use strict";

  var hero = document.querySelector("[data-game]");
  if (!hero) return;

  var hintEl = document.querySelector("[data-game-hint]");

  var mq = window.matchMedia ? window.matchMedia.bind(window) : null;
  var reduceMotion = !!(mq && mq("(prefers-reduced-motion: reduce)").matches);
  var finePointer = !!(mq && mq("(hover: hover) and (pointer: fine)").matches);

  /* ---------- helpers ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function setHint(t) { if (hintEl) hintEl.textContent = t || ""; }

  // rAF loop that sleeps when fn() returns false and wakes on demand.
  function loop(fn) {
    var id = null, last = 0, alive = true;
    function tick(t) {
      var dt = Math.min(32, t - (last || t)) / 16.667;
      last = t;
      var keep = fn(dt);
      id = keep && alive ? requestAnimationFrame(tick) : null;
      if (!id) last = 0;
    }
    return {
      wake: function () { if (!id && alive) { last = 0; id = requestAnimationFrame(tick); } },
      stop: function () { alive = false; if (id) cancelAnimationFrame(id); id = null; }
    };
  }

  function listen(bag, target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    bag.push(function () { target.removeEventListener(type, fn, opts); });
  }

  // Live --fg / --bg as "r,g,b" so the canvas follows the light/dark theme.
  var fgRGB = "10,10,10", bgRGB = "249,249,247";
  var themeListeners = [];
  function hexRGB(v) {
    var m = /^#([0-9a-f]{6})$/i.exec(v.trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function refreshFg() {
    var cs = getComputedStyle(document.documentElement);
    var f = hexRGB(cs.getPropertyValue("--fg")), b = hexRGB(cs.getPropertyValue("--bg"));
    if (f) fgRGB = f.join(",");
    if (b) bgRGB = b.join(",");
    themeListeners.forEach(function (fn) { fn(); });
  }
  refreshFg();
  if (mq) {
    var dark = mq("(prefers-color-scheme: dark)");
    if (dark.addEventListener) dark.addEventListener("change", refreshFg);
  }

  var off = [];
  var BEST_KEY = "skate-best";
  var JUMP = 12.2, GRAV = 0.75, FALL = 2.4;

  var stage = el("div", "gm", '<canvas class="gm__cv"></canvas><button type="button" class="gm__btn">Start</button><span class="gm__live" role="status" aria-live="polite"></span>');
  stage.tabIndex = -1; // focused by the Start button, not a tab stop of its own
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-roledescription", "game");
  stage.setAttribute("aria-label", "Skateboard game. Use the Start button, then press space, the up arrow, or tap to jump.");
  hero.appendChild(stage);
  var cv = stage.querySelector("canvas"), g = cv.getContext("2d"), live = stage.querySelector(".gm__live"), btn = stage.querySelector(".gm__btn");

  /* ---- state ---- */
  var w = 0, h = 0, dpr = 1, gy = 0, sx = 90;      // canvas size, ground line, skater x
  var state = "idle";                               // idle | run | dead
  var dist = 0, speed = 0, maxSpeed = 13.5, score = 0, best = 0;
  var sy = 0, vy = 0, held = false, duck = false, crouch = 0;
  var flipT = 0, flipUsed = false, flipDone = false, buf = 0, pop = 0, popTxt = "";
  var grind = null;                                 // the obstacle being grinded, if any
  var obs = [], visible = true, inside = false, deadAt = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { /* ignore */ }

  function col(a) { return "rgba(" + fgRGB + "," + a + ")"; }
  function bgc() { return "rgb(" + bgRGB + ")"; }

  function drawLamps() {
    g.strokeStyle = col(0.22); g.fillStyle = col(0.22); g.lineWidth = 2; g.lineCap = "round";
    g.beginPath();
    for (var x = 170 - ((dist * 0.75) % 960); x < w + 40; x += 960) {
      g.moveTo(x, gy); g.lineTo(x, gy - 132); g.lineTo(x + 22, gy - 138);
    }
    g.stroke();
    for (x = 170 - ((dist * 0.75) % 960); x < w + 40; x += 960) g.fillRect(x + 17, gy - 140, 12, 4);
  }

  function drawGround() {
    g.strokeStyle = col(0.85); g.lineWidth = 2; g.lineCap = "butt";
    g.beginPath(); g.moveTo(0, gy + 1); g.lineTo(w, gy + 1); g.stroke();
    g.strokeStyle = col(0.2); g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, gy + 12.5); g.lineTo(w, gy + 12.5);
    for (var x = -(dist % 110); x < w + 12; x += 110) { g.moveTo(x, gy + 2); g.lineTo(x - 7, gy + 12); }
    g.stroke();
  }

  /* ---- obstacles: origin = bottom-left on the ground, y grows upward as negative ---- */
  function body() { g.fillStyle = bgc(); g.strokeStyle = col(0.9); g.lineWidth = 2; g.lineJoin = "round"; }
  var TYPES = [
    { w: 26, h: 40, draw: function () { // traffic cone
      body(); g.beginPath(); g.rect(0, -4, 26, 4); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(5, -4); g.lineTo(10.5, -38); g.lineTo(15.5, -38); g.lineTo(21, -4); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(7.8, -21); g.lineTo(18.2, -21); g.moveTo(6.4, -12.5); g.lineTo(19.6, -12.5); g.stroke();
    } },
    { w: 34, h: 48, draw: function () { // bin
      body(); g.beginPath(); g.moveTo(3, -43); g.lineTo(6, 0); g.lineTo(28, 0); g.lineTo(31, -43); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.rect(0, -48, 34, 5); g.fill(); g.stroke();
      g.strokeStyle = col(0.45); g.lineWidth = 1.5; g.beginPath();
      [12, 17, 22].forEach(function (x) { g.moveTo(x, -37); g.lineTo(x, -7); });
      g.stroke();
    } },
    { w: 22, h: 40, draw: function () { // hydrant
      body(); g.beginPath(); g.rect(3, -6, 16, 6); g.fill(); g.stroke();
      g.beginPath(); g.rect(5, -32, 12, 26); g.fill(); g.stroke();
      g.beginPath(); g.arc(11, -32, 6, Math.PI, 0); g.fill(); g.stroke();
      g.beginPath(); g.rect(0, -25, 5, 7); g.rect(17, -25, 5, 7); g.fill(); g.stroke();
    } },
    { w: 34, h: 34, draw: function () { // plain box
      body(); g.beginPath(); g.rect(1, -33, 32, 32); g.fill(); g.stroke();
    } },
    { w: 76, h: 34, grind: true, draw: function () { // bench
      body(); g.beginPath(); g.moveTo(8, 0); g.lineTo(8, -18); g.moveTo(68, 0); g.lineTo(68, -18); g.stroke();
      g.beginPath(); g.moveTo(5, -24); g.lineTo(5, -33); g.moveTo(71, -24); g.lineTo(71, -33); g.stroke();
      g.beginPath(); g.rect(0, -24, 76, 6); g.fill(); g.stroke();
      g.beginPath(); g.rect(2, -34, 72, 5); g.fill(); g.stroke();
    } },
    { w: 60, h: 34, draw: function () { // road-works barrier
      body(); g.beginPath(); g.moveTo(6, 0); g.lineTo(6, -25); g.moveTo(54, 0); g.lineTo(54, -25); g.stroke();
      [-34, -19].forEach(function (y) {
        g.beginPath(); g.rect(0, y, 60, 9); g.fill(); g.stroke();
        g.save(); g.beginPath(); g.rect(0, y, 60, 9); g.clip();
        g.strokeStyle = col(0.55); g.lineWidth = 2; g.beginPath();
        for (var x = -4; x < 64; x += 10) { g.moveTo(x, y + 9); g.lineTo(x + 9, y); }
        g.stroke(); g.restore();
      });
    } }
  ];

  function drawObstacles() {
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      g.save(); g.translate(o.x, gy); o.t.draw(); g.restore();
    }
  }

  /* ---- the skater ---- */
  var STAND = { bk: [-9, -13], fk: [11, -13], bn: [-7, -26], fn: [12, -27], hip: [1, -40], sh: [2, -62], hd: [3, -71], fa: [15, -52], ba: [-12, -54] };
  var CROUCH = { bk: [-9, -13], fk: [11, -13], bn: [-12, -24], fn: [14, -24], hip: [0, -32], sh: [5, -50], hd: [8, -59], fa: [20, -42], ba: [-14, -46] };
  function pt(k, t) { return [STAND[k][0] + (CROUCH[k][0] - STAND[k][0]) * t, STAND[k][1] + (CROUCH[k][1] - STAND[k][1]) * t]; }

  function drawBoard(spin) {
    g.save();
    g.translate(0, -12);
    g.scale(1, spin ? Math.cos(spin * Math.PI * 4) : 1);
    g.translate(0, 12);
    g.strokeStyle = col(0.95); g.fillStyle = col(0.95); g.lineWidth = 2.5; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); g.moveTo(-27, -17); g.lineTo(-22, -12); g.lineTo(22, -12); g.lineTo(27, -17); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(-16, -12); g.lineTo(-16, -10); g.moveTo(16, -12); g.lineTo(16, -10); g.stroke();
    g.fillStyle = bgc(); g.lineWidth = 2;
    if (!grind) { // wheels hang behind the edge while grinding
      g.beginPath(); g.arc(-16, -5, 4.6, 0, 6.2832); g.fill(); g.stroke();
      g.beginPath(); g.arc(16, -5, 4.6, 0, 6.2832); g.fill(); g.stroke();
    }
    g.restore();
  }

  function drawRider(t) {
    var bk = pt("bk", t), fk = pt("fk", t), bn = pt("bn", t), fn = pt("fn", t), hip = pt("hip", t),
        sh = pt("sh", t), hd = pt("hd", t), fa = pt("fa", t), ba = pt("ba", t);
    g.strokeStyle = col(0.95); g.fillStyle = col(0.95); g.lineWidth = 3.2; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    g.moveTo(bk[0], bk[1]); g.lineTo(bn[0], bn[1]); g.lineTo(hip[0], hip[1]);
    g.moveTo(fk[0], fk[1]); g.lineTo(fn[0], fn[1]); g.lineTo(hip[0], hip[1]);
    g.lineTo(sh[0], sh[1]);
    g.moveTo(sh[0], sh[1] + 2); g.lineTo(fa[0], fa[1]);
    g.moveTo(sh[0], sh[1] + 2); g.lineTo(ba[0], ba[1]);
    g.stroke();
    g.beginPath(); g.arc(hd[0], hd[1], 6, 0, 6.2832); g.fill();
  }

  function drawSparks() { // flicker behind the rear truck, in skater space
    g.strokeStyle = col(0.9); g.lineWidth = 1.8; g.lineCap = "round";
    g.beginPath();
    var k = Math.floor(dist / 4) % 3;
    for (var i = 0; i < 3; i++) {
      var len = 7 + ((i + k) % 3) * 4, rise = 3 + ((i * 2 + k) % 3) * 3;
      g.moveTo(-20, -9 - i * 0.5); g.lineTo(-20 - len, -9 - rise);
    }
    g.stroke();
  }

  function drawSkater() {
    g.save();
    g.translate(sx, gy - sy);
    var dead = state === "dead";
    g.rotate(dead ? -0.28 : -clamp(vy * 0.012, -0.16, 0.16));
    drawBoard(flipT);
    if (dead) { g.translate(-5, -2); g.rotate(-0.22); }
    drawRider(dead ? 1 : crouch);
    if (grind) drawSparks();
    g.restore();
  }

  /* ---- text ---- */
  function pad(n) { n = String(Math.floor(n)); while (n.length < 5) n = "0" + n; return n; }
  function drawText() {
    g.textBaseline = "alphabetic";
    g.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "right";
    var right = w - 24;
    g.fillStyle = col(0.9); g.fillText(pad(score), right, 72);
    g.fillStyle = col(0.45); g.fillText("HI " + pad(best), right - 56, 72);
    g.textAlign = "center";
    if (state === "dead") {
      g.font = "600 22px Inter, system-ui, sans-serif"; g.fillStyle = col(0.95);
      g.fillText("Game over", w / 2, btnY() - 18);
    }
    if (pop > 0) {
      g.font = "600 12px Inter, system-ui, sans-serif"; g.textAlign = "left"; g.fillStyle = col(Math.min(1, pop / 20) * 0.9);
      g.fillText(popTxt, sx + 34, gy - 92 - (40 - pop) * 0.5);
    }
  }

  function btnY() { return Math.max(130, gy * 0.5); }
  function syncBtn() {
    btn.hidden = state === "run";
    btn.textContent = state === "dead" ? "Play again" : "Start";
    btn.style.top = btnY() + "px";
  }

  function render() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    drawLamps();
    drawGround();
    drawObstacles();
    drawSkater();
    drawText();
  }

  /* ---- game logic ---- */
  function jump() { var grinding = !!grind; grind = null; vy = JUMP; if (!grinding) sy = 0.01; flipUsed = false; flipT = 0; flipDone = false; buf = 0; }
  function start() {
    state = "run"; syncBtn(); speed = reduceMotion ? 5 : 6.5; maxSpeed = reduceMotion ? 7 : 13.5;
    score = 0; obs = []; grind = null; sy = 0; vy = 0; flipT = 0; flipUsed = false; flipDone = false; buf = 0; pop = 0;
    live.textContent = "Go";
    setHint(finePointer ? "Space / ↑ jump · hold for height · again in the air = kickflip · ↓ drop" : "Tap to jump · tap in the air for a kickflip");
  }
  function die() {
    state = "dead"; deadAt = performance.now(); held = false; syncBtn();
    if (Math.floor(score) > best) {
      best = Math.floor(score);
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
    }
    live.textContent = "Game over. Score " + Math.floor(score) + ". Best " + best + ".";
    setHint("Press Play again");
  }
  function press() {
    held = true;
    if (state === "idle") { start(); jump(); }
    else if (state === "dead") { if (performance.now() - deadAt > 400) { start(); jump(); } }
    else if (sy <= 0.5 || grind) jump(); // off the ground, or ollie off the bench
    else if (sy > 22 && !flipUsed && !reduceMotion) { flipUsed = true; flipT = 0.0001; }
    else buf = 7; // pressed a hair before landing: jump as soon as we touch down
    lp.wake();
  }
  function startFromButton() {
    if (state === "dead" && performance.now() - deadAt < 400) return;
    start();
    stage.focus({ preventScroll: true }); // so Space / ↑ work straight away
    lp.wake();
  }
  function release() {
    held = false;
    if (state === "run" && vy > 5) vy = 5; // let go early = shorter jump
  }

  function spawn() {
    var t = TYPES[Math.floor(Math.random() * TYPES.length)];
    obs.push({ t: t, x: w + 40, w: t.w, h: t.h });
    if (score > 120 && t.w < 40 && Math.random() < 0.28) obs.push({ t: t, x: w + 40 + t.w + 10, w: t.w, h: t.h });
  }
  function hit() {
    var l = sx - 17, r = sx + 17;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o === grind || o.grinded) continue;
      if (o.x + 3 < r && o.x + o.w - 3 > l && sy < o.h - 5) return true;
    }
    return false;
  }

  /* ---- grinding: come down on a bench from above and the trucks lock onto its top edge ---- */
  var GRIND_LIFT = 10;                              // trucks sit this far above the skater's origin
  function updateGrind(prevSy) {
    if (grind) {
      if (sx >= grind.x + grind.w - 6) { grind.grinded = true; grind = null; } // off the end: fall back to the street
      return;
    }
    if (vy >= 0) return;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (!o.t.grind || o.grinded) continue;
      if (sx < o.x - 10 || sx > o.x + o.w - 14) continue;
      if (prevSy < o.h - 5 || sy >= o.h - 5) continue; // only when crossing the bench top on the way down
      grind = o; sy = o.h - GRIND_LIFT; vy = 0;
      if (flipDone) score += 10;
      flipT = 0; flipDone = false; flipUsed = false;
      score += 15; popTxt = "+15 grind"; pop = 40;
      return;
    }
  }

  function update(dt) {
    crouch += ((sy > 2 || (held && state === "run") ? 1 : 0) - crouch) * Math.min(1, 0.25 * dt);
    if (pop > 0) pop -= dt;
    if (state === "idle") { dist += 1.2 * dt; return; }
    if (state !== "run") return;

    speed = Math.min(maxSpeed, speed + 0.0025 * dt);
    dist += speed * dt;
    score += speed * dt * 0.025;

    var prevSy = sy;
    if (sy > 0 && !grind) {
      vy -= GRAV * (duck ? FALL : 1) * dt;
      sy += vy * dt;
      if (flipT > 0) { flipT += dt / 30; if (flipT >= 1) { flipT = 0; flipDone = true; } }
      if (sy <= 0) { // touchdown
        sy = 0; vy = 0;
        if (flipDone) { score += 10; popTxt = "+10 kickflip"; pop = 40; }
        flipT = 0; flipDone = false; flipUsed = false;
        if (buf > 0) jump();
      }
    }
    if (buf > 0) buf -= dt;

    var last = obs[obs.length - 1];
    if (!last || (w + 40) - (last.x + last.w) >= speed * (34 + Math.random() * 30) + 50) spawn();
    for (var i = obs.length - 1; i >= 0; i--) {
      obs[i].x -= speed * dt;
      if (obs[i].x + obs[i].w < -20) obs.splice(i, 1);
    }
    updateGrind(prevSy);
    if (hit()) die();
  }

  var lp = loop(function (dt) {
    if (!visible) return false;
    update(dt);
    render();
    return state === "run" || (state === "idle" && !reduceMotion);
  });

  /* ---- layout ---- */
  function size() {
    var hr = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hr.width; h = hr.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    sx = clamp(w * 0.16, 70, 200);
    gy = Math.max(200, Math.round(h * 0.62));
    syncBtn();
    render();
  }

  /* ---- input ---- */
  function typing(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
  var UP = { Space: 1, ArrowUp: 1, KeyW: 1 }, DOWN = { ArrowDown: 1, KeyS: 1 };
  listen(off, window, "keydown", function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    var focused = document.activeElement === stage;
    var onControl = e.target && e.target.closest && e.target.closest("button, a, summary");
    if (!focused && !(inside && !onControl)) return;
    if (!focused && state !== "run" && e.code !== "Space") return; // hovering shouldn't steal the arrow keys
    if (UP[e.code] || (focused && e.code === "Enter")) { e.preventDefault(); if (!e.repeat) press(); }
    else if (DOWN[e.code]) { e.preventDefault(); duck = true; }
  });
  listen(off, window, "keyup", function (e) {
    if (UP[e.code] || e.code === "Enter") release();
    else if (DOWN[e.code]) duck = false;
  });
  listen(off, btn, "click", startFromButton);
  listen(off, stage, "pointerdown", function (e) {
    if (state !== "run" || (e.pointerType === "mouse" && e.button !== 0)) return; // the button starts a run, not the background
    press();
  });
  listen(off, stage, "pointerup", release);
  listen(off, stage, "pointercancel", release);
  listen(off, hero, "pointerenter", function () { inside = true; });
  listen(off, hero, "pointerleave", function () { inside = false; });
  listen(off, window, "blur", function () { duck = false; release(); });
  listen(off, window, "resize", size);

  function theme() { render(); }
  themeListeners.push(theme);
  var io = null;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) lp.wake(); });
    io.observe(hero);
  }

  size();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { size(); });
  lp.wake();
  setHint(finePointer ? "Press Start · then Space / ↑ to jump · ↓ drop" : "Press Start, then tap to jump");

})();
