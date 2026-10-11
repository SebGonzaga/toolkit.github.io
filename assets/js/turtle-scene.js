/**
 * turtle-scene.js
 * Side-view "hill climb" skin for the turtle race. Pure rendering: the
 * outcome still comes from RaceEngine (progressAt / modeAt per entrant);
 * this file only decides how that journey LOOKS.
 *
 *  - The trail is a rolling climb to a summit flag. Turtles tilt to the
 *    slope, their stride is tied to distance covered, and a puddle splashes.
 *  - Engine SURGE phases  -> the turtle tucks into its shell and slides.
 *  - Engine FATIGUE phases -> the turtle drifts off to sleep (Zzz) while a
 *    hare dozes by the trail. When the leader passes, the hare wakes up and
 *    chases, arriving too late.
 *  - Layered parallax (mountains, clouds, hills) follows the leader.
 *  - An elevation-profile HUD shows every turtle as a dot.
 *
 * No external art assets: everything is drawn with canvas paths.
 */
const TurtleScene = (() => {
  const H = 540;                       // logical height; logical width follows the canvas aspect
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const ORD = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  const PALETTE = ["#2a9d8f", "#e8833a", "#8b5cf6", "#3b82f6", "#e0526b", "#f2b705", "#4caf50", "#c04fb5"];
  const SKIN = "#7fbf63", SKIN_DARK = "#5e9e4a", SKIN_FAR = "#4f8a3f";

  function colorFor(i) {
    if (i < PALETTE.length) return PALETTE[i];
    const hue = (i * 137.5) % 360;
    return `hsl(${hue.toFixed(0)} 62% ${48 + (i % 3) * 5}%)`;
  }
  // Darken / lighten a #rrggbb or hsl() color by mixing with black/white.
  function tone(color, amt) {
    let r, g, b;
    if (color[0] === "#") { const n = parseInt(color.slice(1), 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else {
      const m = color.match(/hsl\(([\d.]+) (\d+)% (\d+)%\)/); const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
      r = Math.round(f(h + 1 / 3) * 255); g = Math.round(f(h) * 255); b = Math.round(f(h - 1 / 3) * 255);
    }
    const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const reduced = !!opts.reducedMotion;
    const onEvent = opts.onEvent || (() => {});

    let W = 864, sx = 1, projector = false;
    let X0 = 170, X1 = 1900, worldLen = 2160;           // start line, summit flag, end of world
    let turtles = [], n = 0, rows = 4, laneGap = 16, bandHalf = 40, S = 64;
    let cam = 0, zoom = 1, time = 0;
    let hare = null, hudDots = [], hudSvg = null, hudProfile = null;
    let callouts = [], particles = [];
    let leaderIdx = -1, crownPop = 0, lastCallout = -9, winnerName = null, winnerT = 0, vignette = 0;
    let racing = false, started = false;
    const puddles = [0.22, 0.62];                       // trail progress (0..1) of the puddles

    // ---------------------------------------------------------------- terrain
    // One rolling trail shared by the art, the HUD profile and every slope calc.
    function trailY(x) {
      const u = clamp((x - X0) / (X1 - X0), 0, 1);
      const climb = H * 0.34 * (0.8 * u + 0.2 * smooth(u));
      const wave = Math.sin(TAU * (3.3 * u + 0.12)) * 19 * Math.pow(Math.sin(Math.PI * u), 0.7);
      return H * 0.79 - climb + wave;
    }
    function slopeAt(x) { return Math.atan2(trailY(x - 4) - trailY(x + 4), 8); }   // + = uphill

    // ---------------------------------------------------------------- sizing
    function resize() {
      const r = canvas.getBoundingClientRect();
      const cssW = Math.max(240, r.width || 640), cssH = Math.max(240, r.height || 400);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      W = clamp(Math.round(H * cssW / cssH), 380, 1100);
      sx = canvas.width / W;
      const courseLen = Math.max(1500, W * 1.9);
      X0 = 250; X1 = X0 + courseLen; worldLen = X1 + 260;
      layoutTurtles();
      if (hudProfile) drawProfile();
      if (!racing) render();
    }

    function sizing(count) {
      S = count <= 6 ? 84 : count <= 10 ? 74 : count <= 16 ? 58 : count <= 24 ? 46 : 38;
      if (W < 500) S *= 0.9;
      rows = count <= 3 ? Math.max(1, count) : count <= 9 ? 3 : count <= 14 ? 4 : count <= 24 ? 5 : 6;
      laneGap = Math.max(9, S * 0.34);
      bandHalf = (rows * laneGap) / 2 + 12;
    }

    function layoutTurtles() {
      sizing(n);
      const perRow = new Array(rows).fill(0);
      turtles.forEach((t) => {
        const k = perRow[t.row]++;
        t.d = k * S * 0.92 + (t.row % 2) * S * 0.42;      // start-grid stagger, behind the line
        t.scale = (S / 72) * (0.9 + 0.17 * (rows > 1 ? t.row / (rows - 1) : 0.5));
        t.laneY = (t.row - (rows - 1) / 2) * laneGap;
      });
      // After the line each turtle ambles to a resting spot past the flag, queued within its own
      // row: the earliest finisher goes furthest, so the winner stands clear of the pack.
      for (let r = 0; r < rows; r++) {
        const inRow = turtles.filter((t) => t.row === r).sort((a, b) => a.entrant.finishTime - b.entrant.finishTime);
        const gap = Math.min(S * 0.85, 170 / Math.max(1, inRow.length - 1));
        inRow.forEach((t, k) => { t.restX = 46 + (inRow.length - 1 - k) * gap; });
      }
      const w = turtles.reduce((a, b) => (a.entrant.finishTime <= b.entrant.finishTime ? a : b), turtles[0]);
      if (w) w.restX = Math.max(w.restX, 46 + 2 * Math.min(S * 0.85, 85)) + 14;
    }

    // ---------------------------------------------------------------- roster
    function setEntrants(entrants) {
      n = entrants.length;
      sizing(n);
      const slots = Array.from({ length: n }, (_, i) => i % rows);
      for (let i = slots.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [slots[i], slots[j]] = [slots[j], slots[i]]; }
      turtles = entrants.map((entrant, i) => ({
        entrant, name: entrant.name, color: colorFor(i), row: slots[i],
        p: 0, x: X0, y: 0, tilt: 0, stride: Math.random() * TAU, lastX: X0,
        tuck: 0, nap: 0, napTimer: 0, mode: 0, prevMode: 0, effort: 0,
        rank: i + 1, crossed: false, inPuddle: false, hop: 0, blink: Math.random() * 4,
      }));
      layoutTurtles();
      turtles.forEach((t) => { t.x = X0 - t.d; t.lastX = t.x; });
      cam = 0; zoom = 1; leaderIdx = -1; crownPop = 0; winnerName = null; winnerT = 0; vignette = 0;
      callouts = []; particles = []; started = false; racing = false;
      const hx = X0 + (X1 - X0) * 0.34;
      hare = { x: hx, home: hx, state: "sleep", t: 0, hop: 0, bubble: "", bubbleT: 0, zT: 0 };
      buildHud();
      render();
    }

    // ---------------------------------------------------------------- HUD (SVG elevation profile)
    function attachHud(svg) { hudSvg = svg; buildHud(); }
    function buildHud() {
      if (!hudSvg) return;
      const NS = "http://www.w3.org/2000/svg";
      hudSvg.innerHTML = "";
      const defs = document.createElementNS(NS, "defs");
      defs.innerHTML = `<linearGradient id="tsProfGrad" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ffd75e"/><stop offset=".45" stop-color="#ff8f6b"/><stop offset="1" stop-color="#5b9bff"/></linearGradient>`;
      hudSvg.appendChild(defs);
      hudProfile = document.createElementNS(NS, "path");
      hudProfile.setAttribute("fill", "none"); hudProfile.setAttribute("stroke", "url(#tsProfGrad)");
      hudProfile.setAttribute("stroke-width", "3"); hudProfile.setAttribute("stroke-linecap", "round"); hudProfile.setAttribute("stroke-linejoin", "round");
      hudSvg.appendChild(hudProfile);
      const flag = document.createElementNS(NS, "g");
      flag.setAttribute("id", "tsProfFlag");
      flag.innerHTML = `<line x1="0" y1="0" x2="0" y2="-13" stroke="#fff" stroke-width="1.6"/><path d="M0 -13 L9 -10 L0 -7 Z" fill="#fff"/>`;
      hudSvg.appendChild(flag);
      hudDots = turtles.map((t) => {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("r", "4"); c.setAttribute("fill", t.color); c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "1.2");
        hudSvg.appendChild(c);
        return c;
      });
      drawProfile();
      updateHud();
    }
    const PW = 240, PH = 40, PPAD = 8;
    function profPoint(p) {
      const x = PPAD + p * (PW - PPAD * 2 - 8);
      const yMin = trailY(X1), yMax = trailY(X0) + 22, wx = X0 + p * (X1 - X0);
      const y = 8 + (1 - (yMax - trailY(wx)) / (yMax - yMin + 14)) * (PH - 16) + 2;
      return [x, y];
    }
    function drawProfile() {
      if (!hudProfile) return;
      let d = "";
      for (let i = 0; i <= 48; i++) { const [x, y] = profPoint(i / 48); d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }
      hudProfile.setAttribute("d", d);
      const [fx, fy] = profPoint(1);
      const flag = hudSvg.querySelector("#tsProfFlag");
      if (flag) flag.setAttribute("transform", `translate(${(fx + 4).toFixed(1)} ${(fy - 1).toFixed(1)})`);
    }
    function updateHud() {
      if (!hudSvg) return;
      turtles.forEach((t, i) => {
        const [x, y] = profPoint(clamp(t.p, 0, 1));
        const dot = hudDots[i]; if (!dot) return;
        dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", (y - 1).toFixed(1));
        const lead = i === leaderIdx && started;
        dot.setAttribute("r", lead ? "5.6" : "4");
        dot.setAttribute("stroke", lead ? "#ffd75e" : "#fff");
        dot.setAttribute("stroke-width", lead ? "2" : "1.2");
      });
      if (leaderIdx >= 0 && hudDots[leaderIdx]) hudSvg.appendChild(hudDots[leaderIdx]); // leader dot on top
    }

    // ---------------------------------------------------------------- particles
    function emit(type, x, y, o = {}) {
      if (particles.length > 380) return;
      particles.push(Object.assign({ type, x, y, vx: 0, vy: 0, life: 0, max: 0.8, size: 3, rot: 0, color: "#fff" }, o));
    }

    // ---------------------------------------------------------------- per-frame simulation
    function frame(vt, dt, state = {}) {
      time += dt;
      racing = !!state.racing;
      started = vt > 0 || racing;
      const finishedAt = state.winnerName ? state.winnerName : null;
      if (finishedAt && winnerName !== finishedAt) { winnerName = finishedAt; winnerT = 0; celebrateStart(); }
      if (winnerName) winnerT += dt;
      vignette += ((state.slowMo ? 1 : 0) - vignette) * Math.min(1, dt * 4);

      let best = -1, bestKey = -1, surging = 0;
      turtles.forEach((t, i) => {
        const e = t.entrant;
        t.p = vt > 0 ? e.progressAt(vt) : 0;
        const done = t.p >= 0.999;
        let x = lerp(X0 - t.d, X1, t.p);
        if (done) {
          if (!t.crossed) { t.crossed = true; if (e.name !== winnerName) emit("dust", x, trailY(x), { vx: 30, size: 6 }); }
          const since = vt - e.finishTime;
          x = X1 + t.restX * smooth(since / 0.9);
        } else t.crossed = false;
        const dx = x - t.x;
        t.x = x;
        t.y = trailY(x) + t.laneY;
        const target = slopeAt(x);
        t.tilt += (target - t.tilt) * Math.min(1, dt * 10);
        t.stride += Math.max(0, dx) * 0.13;                       // legs follow the ground, not the clock
        t.speed = dt > 0 ? Math.max(0, dx) / dt : 0;

        const m = (vt > 0 && !done) ? e.modeAt(vt) : 0;
        t.prevMode = t.mode; t.mode = m;
        t.tuck += ((m === 1 ? 1 : 0) - t.tuck) * Math.min(1, dt * 11);
        t.napTimer = m === -1 ? t.napTimer + dt : Math.max(0, t.napTimer - dt * 3);
        t.nap += ((t.napTimer > 0.18 ? 1 : 0) - t.nap) * Math.min(1, dt * 5);
        t.effort += (clamp(target * 6, 0, 1) - t.effort) * Math.min(1, dt * 6);
        t.hop = (winnerName === e.name) ? winnerT : 0;
        if (m === 1 && t.tuck > 0.5) surging++;

        // shell-slide callout + whoosh (rate limited so a crowd doesn't spam)
        if (m === 1 && t.prevMode !== 1 && time - lastCallout > 1.6 && (n <= 14 || t.rank <= 5)) {
          lastCallout = time;
          callouts.push({ text: "Shell slide!", x: t.x - 34 * t.scale, y: t.y + 30 * t.scale, life: 0, max: 1.5 });
          onEvent("slide", t);
        }
        if (m === -1 && t.prevMode !== -1 && t.napTimer === 0) onEvent("nap-start", t);
        // dust from fast feet, sleepy z's from napping heads
        if (t.speed > 38 && Math.random() < dt * (t.tuck > 0.5 ? 26 : 7)) emit("dust", t.x - 18 * t.scale, trailY(t.x) + t.laneY + 3, { vx: -14 - Math.random() * 12, vy: -6 - Math.random() * 8, size: 3 + Math.random() * 3 * t.scale, max: 0.6 });
        if (t.nap > 0.6 && Math.random() < dt * 1.6) emit("z", t.x + 26 * t.scale, t.y - 38 * t.scale, { vx: 7, vy: -16, max: 1.5, size: 8 + Math.random() * 5 });
        // puddles
        const inP = puddles.some((pp) => Math.abs(x - (X0 + pp * (X1 - X0))) < 26);
        if (inP && t.speed > 10 && Math.random() < dt * 14) {
          for (let k = 0; k < 2; k++) emit("drop", x + 10 * t.scale, t.y, { vx: 20 + Math.random() * 26, vy: -60 - Math.random() * 40, max: 0.55, size: 2.2 });
        }
        if (inP && !t.inPuddle) onEvent("splash", t);
        t.inPuddle = inP;
      });

      // ranking: finished turtles by finish time, the rest by distance covered
      const keys = turtles.map((t, i) => {
        const k = t.p >= 0.999 ? 1e6 + (1000 - t.entrant.finishTime) : t.x;
        if (k > bestKey) { bestKey = k; best = i; }
        return { i, k };
      }).sort((a, b) => b.k - a.k);
      keys.forEach((r, rank) => { turtles[r.i].rank = rank + 1; });
      if (started && best !== leaderIdx) {
        if (leaderIdx !== -1) { crownPop = 0; onEvent("lead", turtles[best]); }
        leaderIdx = best;
      }
      crownPop = Math.min(1, crownPop + dt * 4);

      // the hare: dozes by the trail, wakes when the first turtle passes, chases, arrives late
      stepHare(dt, turtles[leaderIdx] ? turtles[leaderIdx].x : 0);

      // camera follows the leader, easing so it never snaps
      const leadX = turtles[leaderIdx] ? turtles[leaderIdx].x : X0;
      const camTarget = clamp(leadX - W * 0.58, 0, worldLen - W);
      cam += (camTarget - cam) * Math.min(1, dt * 3.2);
      const zt = reduced ? 1 : 1 + 0.06 * smooth(((state.progress || 0) - 0.55) / 0.45) + 0.03 * vignette;
      zoom += (zt - zoom) * Math.min(1, dt * 2);

      // particles
      particles.forEach((p) => {
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.type === "drop") p.vy += 260 * dt;
        if (p.type === "star") p.vy += 120 * dt;
        if (p.type === "z") p.vx = Math.sin(p.life * 3) * 8;
      });
      particles = particles.filter((p) => p.life < p.max);
      callouts.forEach((c) => { c.life += dt; });
      callouts = callouts.filter((c) => c.life < c.max);

      updateHud();
      render();
      return { leaderIdx, groupSurge: n >= 3 && surging / n >= 0.35, ranked: turtles.slice().sort((a, b) => a.rank - b.rank) };
    }

    function celebrateStart() {
      const t = turtles.find((q) => q.name === winnerName);
      if (!t) return;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * TAU, v = 60 + Math.random() * 150;
        emit("star", t.x, t.y - 30, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, max: 1.4 + Math.random() * 0.6, size: 3 + Math.random() * 4, color: ["#ffd75e", "#fff", "#ff8f6b", "#8be0a8"][i % 4], rot: Math.random() * TAU });
      }
    }

    function stepHare(dt, leadX) {
      const h = hare; h.t += dt; h.zT += dt;
      const finished = !!winnerName;
      if (h.state === "sleep") {
        if (started && leadX > h.home + 40) { h.state = "wake"; h.t = 0; h.bubble = "!"; h.bubbleT = 0; onEvent("hare-wake", h); }
      } else if (h.state === "wake") {
        if (h.t > 0.8) { h.state = "chase"; h.t = 0; h.bubble = ""; }
      } else if (h.state === "chase" || h.state === "arrive") {
        const stopX = X1 - 90;
        const target = finished ? stopX : Math.min(stopX, Math.max(h.x, leadX - 240));
        const dx = (target - h.x) * Math.min(1, dt * (finished ? 1.4 : 2.4));
        h.x += Math.max(0, dx); h.hop += Math.max(0, dx) * 0.09;
        if (finished && Math.abs(stopX - h.x) < 10 && h.state !== "late") { h.state = "late"; h.t = 0; h.bubble = "Too late!"; h.bubbleT = 0; onEvent("hare-late", h); }
      } else if (h.state === "late") { h.bubbleT += dt; }
      if (h.bubble) h.bubbleT += dt;
    }

    // ================================================================= DRAWING
    function render() {
      ctx.setTransform(sx, 0, 0, sx, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const focusX = turtles[leaderIdx] ? turtles[leaderIdx].x - cam : W * 0.5;
      const focusY = turtles[leaderIdx] ? turtles[leaderIdx].y : H * 0.6;
      ctx.save();
      if (zoom !== 1) { ctx.translate(focusX, focusY); ctx.scale(zoom, zoom); ctx.translate(-focusX, -focusY); }
      drawSky();
      drawMountains(0.04, 0.58, 300, 110, 190, "#c2cee3", "#b3c2dc", false);
      drawMountains(0.085, 0.62, 330, 150, 250, "#9fb0cf", "#8e9fbf", true);
      drawBirds();
      drawClouds();
      drawHills(0.2, 0.66, "#a7d38b", 14, 0.011, 0.02, 11);
      drawHills(0.42, 0.72, "#86c06a", 18, 0.008, 0.017, 4, true);
      drawMainHill();
      drawTrail();
      drawDecor();
      drawFinish();
      drawEntities();
      drawParticles();
      drawCallouts();
      drawForeground();
      ctx.restore();
      if (vignette > 0.02) drawVignette();
    }

    function drawSky() {
      const g = ctx.createLinearGradient(0, 0, 0, H * 0.7);
      g.addColorStop(0, "#9ed4fb"); g.addColorStop(0.55, "#c9e8fb"); g.addColorStop(1, "#eaf6fd");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sxp = W * 0.78 - cam * 0.01, syp = H * 0.17;
      const glow = ctx.createRadialGradient(sxp, syp, 6, sxp, syp, 80);
      glow.addColorStop(0, "rgba(255,236,160,0.75)"); glow.addColorStop(1, "rgba(255,236,160,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sxp, syp, 80, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffdc78"; ctx.beginPath(); ctx.arc(sxp, syp, 27, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(sxp - 8, syp - 8, 9, 0, TAU); ctx.fill();
    }

    function drawMountains(f, baseK, spacing, hMin, hMax, col, shade, snow) {
      const off = cam * f, base = H * baseK + 70;
      const i0 = Math.floor((off - 300) / spacing), i1 = Math.ceil((off + W + 300) / spacing);
      for (let i = i0; i <= i1; i++) {
        const px = i * spacing + hash(i + f * 91) * spacing * 0.7 - off;
        const ph = hMin + hash(i * 3.1 + f * 17) * (hMax - hMin);
        const half = ph * (0.95 + hash(i * 5.3) * 0.5);
        const top = base - ph;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(px - half, base); ctx.lineTo(px - half * 0.08, top + 4); ctx.quadraticCurveTo(px, top - 4, px + half * 0.08, top + 4); ctx.lineTo(px + half, base); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade;                              // shaded right facet
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px + half, base); ctx.lineTo(px + half * 0.2, base); ctx.lineTo(px - half * 0.05, top + ph * 0.45); ctx.closePath(); ctx.fill();
        if (snow) {
          const sh = ph * 0.3;
          ctx.fillStyle = "#f4f8fc";
          ctx.beginPath();
          ctx.moveTo(px - half * 0.08 - sh * 0.45, top + sh); ctx.lineTo(px - half * 0.08, top + 4); ctx.quadraticCurveTo(px, top - 4, px + half * 0.08, top + 4);
          ctx.lineTo(px + sh * 0.5 + half * 0.08, top + sh);
          ctx.lineTo(px + sh * 0.2, top + sh * 0.68); ctx.lineTo(px, top + sh * 0.95); ctx.lineTo(px - sh * 0.2, top + sh * 0.66); ctx.closePath(); ctx.fill();
        }
      }
    }

    function drawClouds() {
      const span = W + 460;
      for (let i = 0; i < 6; i++) {
        const sp = 5 + hash(i * 7) * 7, cx0 = hash(i * 13) * span, cy = H * (0.1 + hash(i * 3) * 0.2), sc = 0.7 + hash(i * 9) * 0.8;
        const x = ((cx0 - cam * 0.15 - (reduced ? 0 : time * sp)) % span + span) % span - 230;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.ellipse(x, cy, 52 * sc, 15 * sc, 0, 0, TAU);
        ctx.ellipse(x - 20 * sc, cy - 9 * sc, 24 * sc, 17 * sc, 0, 0, TAU);
        ctx.ellipse(x + 14 * sc, cy - 13 * sc, 28 * sc, 20 * sc, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(190,215,240,0.35)";
        ctx.beginPath(); ctx.ellipse(x + 4 * sc, cy + 8 * sc, 44 * sc, 6 * sc, 0, 0, TAU); ctx.fill();
      }
    }

    function drawBirds() {
      if (reduced) return;
      ctx.strokeStyle = "rgba(60,80,110,0.7)"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        const span = W + 300;
        const x = ((hash(i * 4.4) * span + time * (14 + i * 3) - cam * 0.3) % span + span) % span - 150;
        const y = H * (0.22 + 0.06 * i) + Math.sin(time * 0.8 + i) * 8;
        const flap = Math.sin(time * 7 + i * 2) * 4;
        ctx.beginPath(); ctx.moveTo(x - 8, y - flap); ctx.quadraticCurveTo(x - 3, y - 4, x, y); ctx.quadraticCurveTo(x + 3, y - 4, x + 8, y - flap); ctx.stroke();
      }
    }

    function drawHills(f, baseK, col, amp1, k1, k2, amp2, trees) {
      const off = cam * f, base = H * baseK;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = -10; x <= W + 12; x += 10) {
        const wx = x + off;
        ctx.lineTo(x, base + Math.sin(wx * k1 + 1.3) * amp1 + Math.sin(wx * k2 + 0.4) * amp2 - (f > 0.3 ? 0 : 6));
      }
      ctx.lineTo(W + 12, H); ctx.closePath(); ctx.fill();
      if (trees) {
        const gap = 118, i0 = Math.floor((off - 40) / gap), i1 = Math.ceil((off + W + 40) / gap);
        for (let i = i0; i <= i1; i++) {
          if (hash(i * 2.7) < 0.35) continue;
          const wx = i * gap + hash(i) * 70, x = wx - off;
          const y = base + Math.sin(wx * k1 + 1.3) * amp1 + Math.sin(wx * k2 + 0.4) * amp2 + 3;
          const sc = 0.8 + hash(i * 5) * 0.7;
          ctx.fillStyle = "#5b4a35"; ctx.fillRect(x - 1.5 * sc, y - 6 * sc, 3 * sc, 7 * sc);
          ctx.fillStyle = "#3f8a52";
          for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x, y - (26 - k * 3) * sc + k * 7 * sc); ctx.lineTo(x + (11 - k * 1.5) * sc, y - (6 - k * 4) * sc - 2); ctx.lineTo(x - (11 - k * 1.5) * sc, y - (6 - k * 4) * sc - 2); ctx.closePath(); ctx.fill(); }
        }
      }
    }

    function hillTop(wx) { return trailY(wx) - bandHalf - 30; }
    function drawMainHill() {
      const hg = ctx.createLinearGradient(0, H * 0.3, 0, H);
      hg.addColorStop(0, "#86c565"); hg.addColorStop(0.55, "#74b457"); hg.addColorStop(1, "#5ea24b");
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.moveTo(-6, H);
      for (let x = -6; x <= W + 8; x += 8) ctx.lineTo(x, hillTop(x + cam));
      ctx.lineTo(W + 8, H); ctx.closePath(); ctx.fill();
      // rim light + gentle contour bands that follow the slope
      ctx.strokeStyle = "rgba(190,235,140,0.65)"; ctx.lineWidth = 5; ctx.lineJoin = "round";
      ctx.beginPath(); for (let x = -6; x <= W + 8; x += 8) { const y = hillTop(x + cam) + 3; x === -6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
      [0.6, 1.5].forEach((k, bi) => {
        ctx.strokeStyle = bi ? "rgba(70,130,60,0.18)" : "rgba(70,130,60,0.12)"; ctx.lineWidth = 9;
        ctx.beginPath(); for (let x = -6; x <= W + 8; x += 10) { const y = hillTop(x + cam) + 80 * k + bandHalf * k; x === -6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
      });
    }

    function drawTrail() {
      const a = -12, b = W + 12;
      ctx.lineJoin = "round";
      const band = (inset, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        for (let x = a; x <= b; x += 8) { const y = trailY(x + cam) - bandHalf + inset; x === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        for (let x = b; x >= a; x -= 8) ctx.lineTo(x, trailY(x + cam) + bandHalf - inset);
        ctx.closePath(); ctx.fill();
      };
      band(-3, "#b99a62");                                         // shaded edge
      band(0, "#e9d3a0");                                          // sand
      band(7, "#f2e2b6");                                          // lighter core
      // pebbles and wheel-ruts speckle
      const gap = 23, i0 = Math.floor(cam / gap), i1 = Math.ceil((cam + W) / gap);
      for (let i = i0; i <= i1; i++) {
        const wx = i * gap + hash(i) * 14, x = wx - cam;
        const yy = trailY(wx) + (hash(i * 3.3) - 0.5) * (bandHalf * 1.7);
        ctx.fillStyle = hash(i * 9) > 0.5 ? "rgba(150,115,60,0.35)" : "rgba(255,255,255,0.45)";
        ctx.beginPath(); ctx.ellipse(x, yy, 2 + hash(i * 4) * 2.4, 1.2 + hash(i * 6), 0, 0, TAU); ctx.fill();
      }
      // puddles
      puddles.forEach((pp, idx) => {
        const wx = X0 + pp * (X1 - X0), x = wx - cam;
        if (x < -60 || x > W + 60) return;
        const y = trailY(wx) + 2;
        ctx.fillStyle = "rgba(110,170,220,0.85)"; ctx.beginPath(); ctx.ellipse(x, y, 34, bandHalf * 0.55, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.ellipse(x - 8, y - 4, 13, 3.4, -0.1, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1.2;
        const r = (time * 0.7 + idx) % 1;
        if (!reduced) { ctx.beginPath(); ctx.ellipse(x + 8, y + 3, 6 + r * 14, 2 + r * 5, 0, 0, TAU); ctx.globalAlpha = 1 - r; ctx.stroke(); ctx.globalAlpha = 1; }
      });
      // start line
      const sx0 = X0 - cam;
      if (sx0 > -20 && sx0 < W + 20) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 3; ctx.setLineDash([7, 6]);
        ctx.beginPath(); ctx.moveTo(sx0, trailY(X0) - bandHalf + 4); ctx.lineTo(sx0, trailY(X0) + bandHalf - 4); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    function drawDecor() {
      const gap = 34, i0 = Math.floor((cam - 40) / gap), i1 = Math.ceil((cam + W + 40) / gap);
      const sway = reduced ? 0 : 1;
      for (let i = i0; i <= i1; i++) {
        const r1 = hash(i * 1.9), r2 = hash(i * 7.7), r3 = hash(i * 3.3);
        const wx = i * gap + r1 * gap, x = wx - cam;
        const above = r2 < 0.18;                                    // a few on the slope above the trail
        let y;
        if (above) y = trailY(wx) - bandHalf - 4 - r3 * 22; else y = trailY(wx) + bandHalf + 10 + r3 * (H - trailY(wx) - bandHalf - 30);
        const kind = hash(i * 5.1);
        if (kind < 0.42) {                                          // flowers
          const col = ["#fff", "#ffd75e", "#ff9db4", "#fff"][(i & 3)];
          const wob = Math.sin(time * 2 + i) * 1.4 * sway;
          ctx.strokeStyle = "#4f9a46"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + wob, y); ctx.stroke();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + wob, y, 2.6, 0, TAU); ctx.fill();
          ctx.fillStyle = "#f5a623"; ctx.beginPath(); ctx.arc(x + wob, y, 1, 0, TAU); ctx.fill();
        } else if (kind < 0.62) {                                   // grass tuft
          ctx.strokeStyle = "#4f9a46"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
          for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x + k * 3, y + 3); ctx.lineTo(x + k * 5 + Math.sin(time * 2 + i + k) * sway, y - 6); ctx.stroke(); }
        } else if (kind < 0.74) {                                   // pebble
          ctx.fillStyle = "#b7b2a6"; ctx.beginPath(); ctx.ellipse(x, y, 5 + r3 * 3, 3.3, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.ellipse(x - 1.5, y - 1.2, 2, 1, 0, 0, TAU); ctx.fill();
        } else if (kind < 0.84 && !above && y > H * 0.7 && r3 > 0.45 && (i % 3 === 0)) {   // round tree
          const sc = 0.9 + r3 * 0.8, ty = y;
          ctx.fillStyle = "rgba(30,60,20,0.22)"; ctx.beginPath(); ctx.ellipse(x + 2, ty + 3, 20 * sc, 5 * sc, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = "#6b4d2f"; ctx.fillRect(x - 3 * sc, ty - 24 * sc, 6 * sc, 26 * sc);
          ctx.fillStyle = "#3f9a52"; ctx.beginPath(); ctx.arc(x, ty - 36 * sc, 19 * sc, 0, TAU); ctx.arc(x - 13 * sc, ty - 27 * sc, 13 * sc, 0, TAU); ctx.arc(x + 13 * sc, ty - 28 * sc, 14 * sc, 0, TAU); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.beginPath(); ctx.arc(x - 6 * sc, ty - 43 * sc, 8 * sc, 0, TAU); ctx.fill();
          ctx.fillStyle = "#e0526b"; [[-8, -34], [6, -40], [10, -29]].forEach(([ax, ay]) => { ctx.beginPath(); ctx.arc(x + ax * sc, ty + ay * sc, 2 * sc, 0, TAU); ctx.fill(); });
        } else if (kind < 0.8 && !above && y > H * 0.78) {          // bush
          const sc = 0.9 + r3;
          ctx.fillStyle = "#3f8f4f";
          [[-9, 0, 9], [0, -5, 11], [10, 1, 8]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * sc, y + dy * sc, r * sc, 0, TAU); ctx.fill(); });
          ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.beginPath(); ctx.arc(x - 3 * sc, y - 8 * sc, 5 * sc, 0, TAU); ctx.fill();
        }
      }
      // waypoint signs every quarter of the climb
      [0, 0.25, 0.5, 0.75].forEach((pp, k) => {
        const wx = X0 + pp * (X1 - X0) - 14, x = wx - cam;
        if (x < -40 || x > W + 40) return;
        const y = trailY(wx) - bandHalf - 4;
        ctx.fillStyle = "#7a5a37"; ctx.fillRect(x - 1.8, y - 30, 3.6, 32);
        ctx.fillStyle = "#c79a5c"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 20, y - 34, 40, 15, 3) : ctx.rect(x - 20, y - 34, 40, 15); ctx.fill();
        ctx.fillStyle = "#4a3520"; ctx.font = "700 10px 'Baloo 2', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(k === 0 ? "START" : Math.round(pp * 100) + "%", x, y - 26);
      });
    }

    function drawFinish() {
      const wx = X1, x = wx - cam;
      if (x < -80 || x > W + 80) return;
      const y = trailY(wx), top = y - bandHalf, bot = y + bandHalf;
      // checkered finish band across the trail
      const sq = 8, cols = 2, rowsN = Math.ceil((bot - top) / sq);
      for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#222" : "#fff"; ctx.fillRect(x - sq + c * sq, top + r * sq, sq, Math.min(sq, bot - top - r * sq));
      }
      // cairn
      ctx.fillStyle = "#a9a49a"; ctx.beginPath(); ctx.ellipse(x + 24, top - 4, 15, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#c2bdb2"; ctx.beginPath(); ctx.ellipse(x + 24, top - 12, 10, 5.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#d9d4c9"; ctx.beginPath(); ctx.ellipse(x + 24, top - 19, 6, 4, 0, 0, TAU); ctx.fill();
      // pole + waving checkered flag
      const poleX = x - 2, poleTop = top - 78;
      ctx.fillStyle = "#6b4f2f"; ctx.fillRect(poleX - 2, poleTop, 4, top - poleTop + 8);
      const fw = 40, fh = 26, cs = 6.5, wave = winnerName ? 3.2 : 1.8, spd = winnerName ? 9 : 4.5;
      for (let c = 0; c < Math.ceil(fw / cs); c++) for (let r = 0; r < Math.ceil(fh / cs); r++) {
        const dy = reduced ? 0 : Math.sin(time * spd + c * 0.9) * wave * (c / 3);
        ctx.fillStyle = (r + c) % 2 ? "#1d1d24" : "#fff";
        ctx.fillRect(poleX + 2 + c * cs, poleTop + 2 + r * cs + dy, cs + 0.4, cs + 0.4);
      }
      ctx.fillStyle = "#ffd75e"; ctx.beginPath(); ctx.arc(poleX, poleTop - 2, 4, 0, TAU); ctx.fill();
    }

    // ---------------------------------------------------------------- turtles
    function drawEntities() {
      const list = turtles.map((t) => ({ kind: "t", y: t.y, row: t.row, t }));
      if (hare) list.push({ kind: "h", y: trailY(hare.x) + bandHalf + 34, row: -1 });
      const rowOf = (o) => (o.kind === "h" ? 99 : o.row);
      list.sort((a, b) => (rowOf(a) - rowOf(b)) || ((a.t ? a.t.x : 0) - (b.t ? b.t.x : 0)));
      list.forEach((o) => { if (o.kind === "h") drawHare(); else drawTurtle(o.t); });
      drawLabels();
    }

    function drawTurtle(t) {
      const sxp = t.x - cam;
      if (sxp < -90 || sxp > W + 90) return;
      const lead = t.name === (turtles[leaderIdx] && turtles[leaderIdx].name) && started;
      const winner = winnerName === t.name;
      const sc = t.scale, base = trailY(t.x) + t.laneY;
      // ground shadow
      ctx.fillStyle = "rgba(30,50,20,0.28)";
      ctx.beginPath(); ctx.ellipse(sxp + 2, base + 4 * sc, 30 * sc * (1 - 0.2 * t.tuck), 6 * sc, t.tilt * -0.3, 0, TAU); ctx.fill();

      const hopY = winner ? -Math.abs(Math.sin(winnerT * 6)) * 16 * Math.max(0, 1 - winnerT / 6 * 0.4) : 0;
      const bob = reduced ? 0 : Math.sin(t.stride * 2) * 1.1 * (1 - t.tuck) + (started ? 0 : Math.sin(time * 2 + t.blink) * 0.7);
      ctx.save();
      ctx.translate(sxp, base + hopY + bob);
      ctx.rotate(-t.tilt + (t.tuck * 0.12));
      ctx.scale(sc, sc);
      drawTurtleBody(t, lead, winner);
      ctx.restore();
    }

    function drawTurtleBody(t, lead, winner) {
      const tuck = t.tuck, nap = t.nap, ph = t.stride;
      const shell = t.color, shellDark = tone(shell, -0.32), shellLite = tone(shell, 0.35);
      const idle = !started;
      // ---- far legs, tail, head (behind the shell)
      const legSwing = (a, k) => Math.sin(ph + a) * 0.5 * (1 - tuck) * k;
      const leg = (x, y, ang, col, w = 8, h = 11) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, h * 0.42, w * 0.5 * (1 - tuck * 0.2), h * 0.6 * (1 - tuck * 0.85), 0, 0, TAU); ctx.fill(); ctx.restore();
      };
      leg(-12, -3, legSwing(Math.PI, 1), SKIN_FAR); leg(14, -3, legSwing(0, 1), SKIN_FAR);
      // tail
      ctx.fillStyle = SKIN_DARK; ctx.beginPath(); ctx.moveTo(-24, -9); ctx.lineTo(-35 + tuck * 8, -4); ctx.lineTo(-24, -3); ctx.closePath(); ctx.fill();
      // neck + head: stretches uphill, droops when sleepy, retracts into the shell when tucked
      const ext = (1 - tuck) * (1 + t.effort * 0.5), headX = lerp(14, 34 + t.effort * 3, ext), headY = -13 + nap * 8 + t.effort * 1.5 - (winner ? 3 : 0);
      if (tuck < 0.96) {
        ctx.fillStyle = SKIN; ctx.beginPath(); ctx.ellipse((headX + 20) / 2, headY + 3, (headX - 16) / 2 + 6, 5.4, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(headX, headY, 9, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.arc(headX - 2, headY - 3, 4, 0, TAU); ctx.fill();
        // eye
        const ex = headX + 3.6, ey = headY - 2;
        const blink = !idle ? 0 : (Math.sin(time * 1.3 + t.blink * 5) > 0.97 ? 1 : 0);
        if (nap > 0.5 || blink) {
          ctx.strokeStyle = "#1e2a45"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
          ctx.beginPath(); ctx.arc(ex, ey + 1, 2.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        } else {
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, TAU); ctx.fill();
          ctx.fillStyle = "#1e2a45"; ctx.beginPath(); ctx.arc(ex + 0.9, ey + 0.2, 1.7, 0, TAU); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + 1.3, ey - 0.6, 0.6, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = "rgba(255,120,140,0.45)"; ctx.beginPath(); ctx.arc(headX + 0.5, headY + 3.5, 2.2, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(30,42,69,0.7)"; ctx.lineWidth = 1.2; ctx.lineCap = "round";
        ctx.beginPath();
        if (winner || lead) ctx.arc(headX + 5, headY + 2.8, 3, 0.1 * Math.PI, 0.9 * Math.PI);
        else ctx.arc(headX + 5, headY + 4.5, 2, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
        // sweat drop when grinding uphill
        if (t.effort > 0.45 && !tuck && !nap && started && Math.sin(time * 3 + t.blink * 9) > 0.1) {
          ctx.fillStyle = "rgba(120,190,255,0.95)";
          const dy = (time * 14 + t.blink * 7) % 12;
          ctx.beginPath(); ctx.moveTo(headX - 6, headY - 10 + dy * 0.5); ctx.quadraticCurveTo(headX - 9, headY - 5 + dy * 0.5, headX - 6, headY - 4 + dy * 0.5); ctx.quadraticCurveTo(headX - 3, headY - 5 + dy * 0.5, headX - 6, headY - 10 + dy * 0.5); ctx.fill();
        }
        if (lead && started) drawCrown(headX, headY - 9);
      } else if (lead && started) drawCrown(26, -26);
      // ---- shell dome
      const squash = 1 - tuck * 0.1;
      ctx.save(); ctx.scale(1, squash);
      const g = ctx.createRadialGradient(-8, -26, 3, 0, -8, 36);
      g.addColorStop(0, shellLite); g.addColorStop(0.5, shell); g.addColorStop(1, shellDark);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -2, 27, 28, 0, Math.PI, 0); ctx.lineTo(27, -2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shellDark; ctx.lineWidth = 1.2; ctx.stroke();
      // scutes
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, -2, 27, 28, 0, Math.PI, 0); ctx.closePath(); ctx.clip();
      ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-14, -2); ctx.quadraticCurveTo(-11, -18, -4, -26); ctx.moveTo(14, -2); ctx.quadraticCurveTo(11, -18, 4, -26);
      ctx.moveTo(-24, -12); ctx.quadraticCurveTo(0, -20, 24, -12); ctx.moveTo(-4, -26); ctx.lineTo(0, -19); ctx.lineTo(4, -26); ctx.moveTo(-9, -12); ctx.lineTo(0, -7); ctx.lineTo(9, -12);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.beginPath(); ctx.ellipse(-7, -18, 6, 3.6, -0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.ellipse(15, -8, 5, 3, 0.4, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.restore();
      // belly band
      ctx.fillStyle = "#f1e2b5"; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-27, -4, 54, 7, 3.5); else ctx.rect(-27, -4, 54, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(-26, 0, 52, 2.2);
      // ---- near legs (in front of the belly)
      leg(-17, 1, legSwing(0, 1), SKIN_DARK); leg(20, 1, legSwing(Math.PI, 1), SKIN_DARK);
      // ---- tucked: speed lines streaming behind the sliding shell
      if (tuck > 0.4) {
        ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) {
          const wob = Math.sin(time * 30 + k * 2) * 2, len = 26 + k * 7 + wob * 2;
          ctx.lineWidth = 2.6 - k * 0.5; ctx.globalAlpha = tuck * 0.9;
          ctx.beginPath(); ctx.moveTo(-34 - k * 3, -22 + k * 9); ctx.lineTo(-34 - len - k * 3, -22 + k * 9 + 4 + k * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // ---- big gold halo for the winner
      if (winner) { ctx.strokeStyle = "rgba(255,215,94,0.9)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, -2, 36, 36, 0, Math.PI, 0); ctx.stroke(); }
    }

    function drawCrown(x, y) {
      const pop = smooth(crownPop), s = 0.6 + 0.4 * pop + (winnerName ? 0.15 : 0);
      ctx.save(); ctx.translate(x, y - (1 - pop) * 8); ctx.scale(s, s); ctx.rotate(0.12);
      ctx.fillStyle = "#ffd75e"; ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, -4); ctx.lineTo(0, -11); ctx.lineTo(4, -4); ctx.lineTo(8, -9); ctx.lineTo(8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e0526b"; ctx.beginPath(); ctx.arc(0, -3, 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // ---------------------------------------------------------------- hare
    function drawHare() {
      const h = hare, x = h.x - cam;
      if (x < -60 || x > W + 60) return;
      const y = trailY(h.x) + bandHalf + 34;
      const awake = h.state !== "sleep", sc = Math.max(0.8, S / 70);
      ctx.fillStyle = "rgba(30,50,20,0.25)"; ctx.beginPath(); ctx.ellipse(x, y + 6, 24 * sc, 5 * sc, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      const body = "#c8c3cc", belly = "#ece9ee", inner = "#f2a7b8";
      const moving = h.state === "chase" || h.state === "arrive";
      const hop = moving && !reduced ? Math.abs(Math.sin(h.hop)) * 13 : 0;
      ctx.translate(0, -hop);
      if (!awake) {                                                  // curled up, napping
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, -7, 22, 11, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(2, -3, 14, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-22, -9, 5, 0, TAU); ctx.fill();            // tail
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(19, -9, 9, 0, TAU); ctx.fill();               // head
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(8, -17, 4, 11, 1.25, 0, TAU); ctx.fill();   // ears flopped back
        ctx.fillStyle = inner; ctx.beginPath(); ctx.ellipse(8, -16.6, 2, 8, 1.25, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#3b3550"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(22, -9, 2.4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
        ctx.fillStyle = "#e58aa0"; ctx.beginPath(); ctx.arc(27, -7, 1.5, 0, TAU); ctx.fill();
      } else {                                                       // upright, ears up
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(-2, -13, 14, 16, -0.1, 0, TAU); ctx.fill();
        ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(2, -10, 8, 10, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-15, -9, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(8, -31, 9, 0, TAU); ctx.fill();
        const flop = moving ? Math.sin(h.hop * 2) * 0.25 : 0;
        [[4, -0.15], [11, 0.25]].forEach(([ex, rot], k) => {
          ctx.save(); ctx.translate(ex, -38); ctx.rotate(rot - flop * (k ? -1 : 1)); ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, -11, 4, 12, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = inner; ctx.beginPath(); ctx.ellipse(0, -10, 2, 8.5, 0, 0, TAU); ctx.fill(); ctx.restore();
        });
        if (h.state === "wake" && h.t < 0.5) {
          ctx.strokeStyle = "#3b3550"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(11, -32, 2.2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
        } else {
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(11, -32, 3, 0, TAU); ctx.fill();
          ctx.fillStyle = "#3b3550"; ctx.beginPath(); ctx.arc(12, -32, 1.7, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = "#e58aa0"; ctx.beginPath(); ctx.arc(16.5, -29, 1.5, 0, TAU); ctx.fill();
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(3, -2, 9, 4, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // Zzz floats up while it sleeps; speech bubble when awake
      if (!awake && !reduced) {
        for (let k = 0; k < 3; k++) {
          const ph = ((h.zT * 0.55 + k / 3) % 1), zx = x + 24 + ph * 18, zy = y - 24 - ph * 36;
          ctx.globalAlpha = Math.sin(ph * Math.PI); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#3b3550"; ctx.lineWidth = 3;
          ctx.font = `800 ${12 + ph * 8}px 'Baloo 2', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.strokeText("Z", zx, zy); ctx.fillText("Z", zx, zy);
        }
        ctx.globalAlpha = 1;
      } else if (!awake) {
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#3b3550"; ctx.lineWidth = 3; ctx.font = "800 16px 'Baloo 2', sans-serif"; ctx.textAlign = "center";
        ctx.strokeText("Zzz", x + 30, y - 34); ctx.fillText("Zzz", x + 30, y - 34);
      }
      if (h.bubble) bubble(h.bubble, x + 8, y - 70 * sc, h.bubble === "!" ? "#ffd75e" : "#fff");
    }

    function bubble(text, x, y, fill) {
      ctx.font = "800 15px 'Baloo 2', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = Math.max(24, ctx.measureText(text).width + 16), bh = 24;
      ctx.fillStyle = fill; ctx.strokeStyle = "#1e2a45"; ctx.lineWidth = 2;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - bh / 2, w, bh, 9); else ctx.rect(x - w / 2, y - bh / 2, w, bh);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 4, y + bh / 2 - 1); ctx.lineTo(x, y + bh / 2 + 6); ctx.lineTo(x + 4, y + bh / 2 - 1); ctx.fillStyle = fill; ctx.fill();
      ctx.fillStyle = "#1e2a45"; ctx.fillText(text, x, y + 1);
    }

    // ---------------------------------------------------------------- labels (rank + name), crowd-aware
    function drawLabels() {
      const scale = projector ? 1.3 : 1;
      const showAll = n <= 10, maxShown = n <= 10 ? n : n <= 20 ? 6 : 4;
      const order = turtles.slice().sort((a, b) => a.rank - b.rank);
      const placed = [];
      let shown = 0;
      order.forEach((t, k) => {
        const rank = t.rank, top3 = rank <= 3 && started;
        if (!(showAll || top3 || (started && shown < maxShown) || !started && n <= 14)) return;
        const sxp = t.x - cam; if (sxp < -60 || sxp > W + 60) return;
        const lead = rank === 1 && started, win = winnerName === t.name;
        const name = t.name.length > 12 ? t.name.slice(0, 11) + "…" : t.name;
        const nf = (win ? 19 : lead ? 17 : 15) * scale * (n > 14 ? 0.9 : 1), rf = 12 * scale;
        ctx.font = `800 ${nf}px 'Baloo 2', 'Inter', sans-serif`;
        const nw = ctx.measureText(name).width;
        const hy = t.y - (64 + (t.hop ? Math.abs(Math.sin(winnerT * 6)) * 16 : 0)) * t.scale - (lead ? 6 : 0);
        const boxW = nw + (lead || win ? 14 : 4), boxH = nf + (started ? rf + 2 : 2);
        const box = { x: sxp - boxW / 2, y: hy - boxH, w: boxW, h: boxH };
        const hit = placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y);
        if (hit && rank > 1) return;
        placed.push(box); shown++;
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
        if (lead || win) {
          ctx.fillStyle = win ? "#e8a400" : "#2f5be0";
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(box.x, hy - nf - 1, boxW, nf + 4, 5); else ctx.rect(box.x, hy - nf - 1, boxW, nf + 4); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.fillText(name, sxp, hy - 2);
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 4 * scale; ctx.strokeText(name, sxp, hy - 2);
          ctx.fillStyle = "#1e2a45"; ctx.fillText(name, sxp, hy - 2);
        }
        if (started) {
          ctx.font = `800 ${rf}px 'Baloo 2', 'Inter', sans-serif`;
          const txt = win ? "WINNER" : ORD(rank);
          const col = win ? "#8a5a00" : rank === 1 ? "#8a5a00" : rank === 2 ? "#4b5568" : rank === 3 ? "#8a4a1f" : "#5a4630";
          ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = 3.4 * scale; ctx.strokeText(txt, sxp, hy - nf - 3);
          ctx.fillStyle = col; ctx.fillText(txt, sxp, hy - nf - 3);
        }
      });
    }

    function drawParticles() {
      particles.forEach((p) => {
        const x = p.x - cam, k = p.life / p.max;
        if (x < -30 || x > W + 30) return;
        ctx.globalAlpha = 1 - k;
        if (p.type === "dust") { ctx.fillStyle = "rgba(190,160,105,0.8)"; ctx.beginPath(); ctx.arc(x, p.y, p.size * (0.6 + k), 0, TAU); ctx.fill(); }
        else if (p.type === "drop") { ctx.fillStyle = "rgba(140,200,255,0.95)"; ctx.beginPath(); ctx.arc(x, p.y, p.size, 0, TAU); ctx.fill(); }
        else if (p.type === "z") {
          ctx.font = `800 ${p.size}px 'Baloo 2', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#3b3550"; ctx.lineWidth = 3;
          ctx.strokeText("z", x, p.y); ctx.fillText("z", x, p.y);
        } else if (p.type === "star") {
          ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot + p.life * 4); ctx.fillStyle = p.color;
          ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU, b = a + TAU / 10; ctx.lineTo(Math.cos(a) * p.size, Math.sin(a) * p.size); ctx.lineTo(Math.cos(b) * p.size * 0.45, Math.sin(b) * p.size * 0.45); }
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
      });
      ctx.globalAlpha = 1;
    }

    function drawCallouts() {
      callouts.forEach((c) => {
        const k = c.life / c.max, x = c.x - cam, y = c.y - k * 10;
        ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        ctx.font = `800 ${projector ? 20 : 16}px 'Baloo 2', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.strokeText(c.text, x, y);
        ctx.fillStyle = "#1e2a45"; ctx.fillText(c.text, x, y);
      });
      ctx.globalAlpha = 1;
    }

    function drawForeground() {
      // a darker lip of grass along the bottom that scrolls a touch faster than the world
      const off = cam * 1.12;
      ctx.fillStyle = "#4f9a46";
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = -6; x <= W + 8; x += 8) ctx.lineTo(x, H * 0.935 + Math.sin((x + off) * 0.03) * 3 + Math.sin((x + off) * 0.09) * 1.6);
      ctx.lineTo(W + 8, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#3f8a3c"; ctx.fillRect(0, H * 0.975, W, H);
      const gap = 26, i0 = Math.floor((off - 20) / gap), i1 = Math.ceil((off + W + 20) / gap);
      ctx.strokeStyle = "#3a7d37"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = i0; i <= i1; i++) {
        const x = i * gap + hash(i * 2.2) * gap - off, hh = 8 + hash(i * 6) * 12;
        ctx.beginPath(); ctx.moveTo(x, H * 0.96); ctx.lineTo(x + (hash(i) - 0.5) * 8 + (reduced ? 0 : Math.sin(time * 2 + i) * 1.5), H * 0.96 - hh); ctx.stroke();
      }
    }

    function drawVignette() {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.9);
      g.addColorStop(0, "rgba(10,20,40,0)"); g.addColorStop(1, `rgba(10,20,40,${(0.5 * vignette).toFixed(3)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    return {
      setEntrants, frame, render, resize, attachHud,
      setProjector(v) { projector = !!v; if (!racing) render(); },
      get turtles() { return turtles; },
      get leaderIdx() { return leaderIdx; },
    };
  }

  return { create };
})();

if (typeof module !== "undefined") module.exports = TurtleScene;
