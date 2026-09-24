/**
 * sound-fx.js
 * A tiny, procedurally-synthesized cartoon sound kit for every picker skin.
 * Everything is generated at runtime with Web Audio oscillators + a shared
 * noise buffer, so there are no audio files to license, host, or download.
 *
 * What's in here
 *   - UI sounds   : button boops, hover bloops, toggle pops, slider ticks, typing pips
 *   - Cartoon FX  : boing, pop, squeak, quack, slide whistle, clown horn, bonk, splat
 *   - Comedy      : sad trombone, "uh-oh", rimshot (ba-dum-tss), gasp
 *   - Game FX     : wheel ticks, plinko pings, reel stops, ka-ching, lever, drumroll,
 *                   card flips, deals, balloon pop, rocket launch, footsteps
 *   - Big moments : countdown beeps, "go!" horn, winner fanfare + crowd cheer, party popper
 *
 * SuspenseFX (countdown / shake / flash / burst / spotlight) calls into this
 * automatically when it's loaded, so most skins get sound with zero wiring.
 *
 * Browsers block audio until a user gesture. A one-time listener unlocks the
 * AudioContext on the first click / key press, so nothing needs to call
 * unlock() by hand (though it's still exported).
 *
 * A floating 🔊/🔇 button is injected on every page (except pages that ship
 * their own #soundToggle). The mute state persists in localStorage.
 */
const SoundFX = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem("sfx-muted") === "1"; } catch (e) { /* storage blocked */ }

  const VOLUME = 0.65;
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const later = (fn, ms) => setTimeout(() => { if (!muted) fn(); }, ms);

  // Per-effect rate limiting so busy scenes (100 ducks, a fast wheel) don't
  // become a wall of noise — each named effect has its own minimum gap.
  const lastPlayed = {};
  function allowed(key, minGapMs) {
    const now = performance.now();
    if (lastPlayed[key] && now - lastPlayed[key] < minGapMs) return false;
    lastPlayed[key] = now;
    return true;
  }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      // A gentle compressor keeps stacked effects (fanfare + cheer + pop) from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 5;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function getNoise(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /** Call from a user-gesture handler (click) to unlock audio for the session. */
  function unlock() { ensureCtx(); }
  function isMuted() { return muted; }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem("sfx-muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05);
    document.querySelectorAll(".sfx-fab").forEach(paintFab);
  }

  /* ---------------------------------------------------------------- primitives */

  /**
   * One oscillator note.
   * opts: type, gain, glideTo (exponential pitch slide), delay (s), attack,
   *       sustain (hold level until 75% of dur), vibrato (Hz depth) + vibratoRate,
   *       curve (fn 0..1 -> Hz, for wobbly pitch shapes), filter {type,freq,to,q}
   */
  function tone(freq, dur, opts = {}) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const { type = "sine", gain = 0.25, glideTo = null, delay = 0, attack = 0.012,
            sustain = false, vibrato = 0, vibratoRate = 8, curve = null, filter = null } = opts;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    const t0 = c.currentTime + delay;
    if (curve) {
      const arr = new Float32Array(48);
      for (let i = 0; i < arr.length; i++) arr[i] = curve(i / (arr.length - 1));
      osc.frequency.setValueCurveAtTime(arr, t0, dur);
    } else {
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
    }
    if (vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = vibratoRate;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    if (sustain) g.gain.setValueAtTime(gain, t0 + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || "lowpass";
      f.Q.value = filter.q || 1;
      f.frequency.setValueAtTime(filter.freq, t0);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t0 + dur);
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Filtered noise. opts: filterType, filterFreq, sweepTo, q, gain, fadeIn, delay */
  function noiseBurst(dur, opts = {}) {
    if (muted) return null;
    const c = ensureCtx();
    if (!c) return null;
    const { filterType = "bandpass", filterFreq = 1200, sweepTo = null, q = 1,
            gain = 0.15, fadeIn = 0, delay = 0 } = opts;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = filterType;
    filt.Q.value = q;
    const g = c.createGain();
    const t0 = c.currentTime + delay;
    filt.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 20), t0 + dur);
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + fadeIn);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
    } else {
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(filt).connect(g).connect(master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  function bell(f, delay = 0, gain = 0.1) {
    tone(f, 0.9, { gain, delay });
    tone(f * 2.76, 0.5, { gain: gain * 0.3, delay });
    tone(f * 5.4, 0.2, { gain: gain * 0.15, delay });
  }

  /* ------------------------------------------------------------------ UI sounds */

  function click(kind) {
    if (!allowed("click", 40)) return;
    if (kind === "primary") {
      tone(480, 0.08, { type: "triangle", gain: 0.17, glideTo: 860 });
      tone(1150, 0.07, { type: "sine", gain: 0.05, delay: 0.05 });
    } else {
      tone(760, 0.045, { type: "sine", gain: 0.1, glideTo: 520 });
    }
  }
  function hover() {
    if (!allowed("hover", 70)) return;
    tone(rnd(880, 1000), 0.035, { type: "sine", gain: 0.03 });
  }
  function toggle(on) {
    if (!allowed("toggle", 40)) return;
    tone(on ? 600 : 420, 0.08, { type: "triangle", gain: 0.14, glideTo: on ? 940 : 290 });
  }
  function slider(v01) {
    if (!allowed("slider", 45)) return;
    tone(300 + Math.max(0, Math.min(1, v01)) * 700, 0.035, { type: "triangle", gain: 0.08 });
  }
  function key() {
    if (!allowed("key", 55)) return;
    tone(rnd(700, 1300), 0.03, { type: "triangle", gain: 0.055 });
  }

  /* --------------------------------------------------------------- cartoon FX */

  /** Classic spring "boooing-oing-oing". */
  function boing(p = 1) {
    if (!allowed("boing", 120)) return;
    const base = 230 * p;
    tone(base, 0.6, {
      type: "sine", gain: 0.2, sustain: true,
      curve: (x) => base * Math.pow(2, 0.95 * Math.exp(-3.2 * x) * Math.sin(Math.PI * 2 * 3.5 * x) + 0.35 * (1 - x)),
    });
    tone(base * 2, 0.45, { type: "sine", gain: 0.05, glideTo: base * 1.6 });
  }
  function pop(p = 1) {
    if (!allowed("pop", 60)) return;
    tone(380 * p, 0.09, { gain: 0.22, glideTo: 1100 * p });
  }
  /** Rubber-duck squeak. */
  function squeak(p = 1) {
    if (!allowed("squeak", 110)) return;
    tone(900 * p, 0.07, { type: "square", gain: 0.05, glideTo: 1900 * p, filter: { type: "bandpass", freq: 2000, q: 5 } });
    tone(1700 * p, 0.1, { type: "triangle", gain: 0.1, glideTo: 1100 * p, delay: 0.08 });
  }
  /** Cartoon quack: nasal downward glide. Rate-limited across all callers. */
  function quack(pitchVariance = 1) {
    if (!allowed("quack", 90)) return;
    const f = { type: "bandpass", freq: 1000 * pitchVariance, q: 1.4 };
    tone(300 * pitchVariance, 0.1, { type: "sawtooth", gain: 0.2, glideTo: 160 * pitchVariance, filter: f });
    tone(600 * pitchVariance, 0.06, { type: "square", gain: 0.03, glideTo: 320 * pitchVariance });
  }
  function quackChorus() {
    [1, 1.15, 0.9, 1.3, 1].forEach((p, i) => later(() => quack(p), i * 130 + rnd(0, 40)));
  }
  function slideWhistle(from = 500, to = 1800, dur = 0.5, gain = 0.15) {
    tone(from, dur, { type: "sine", gain, glideTo: to, vibrato: 14, vibratoRate: 9 });
  }
  function clownHorn() {
    if (!allowed("horn", 250)) return;
    const f = { type: "bandpass", freq: 1400, q: 3 };
    tone(466, 0.13, { type: "square", gain: 0.11, filter: f });
    tone(392, 0.24, { type: "square", gain: 0.11, glideTo: 365, delay: 0.16, filter: f });
  }
  function bonk() {
    if (!allowed("bonk", 150)) return;
    tone(500, 0.1, { type: "triangle", gain: 0.25, glideTo: 220 });
    noiseBurst(0.04, { filterFreq: 900, gain: 0.2 });
    later(() => boing(0.8), 70);
  }
  function splat() {
    if (!allowed("splat", 150)) return;
    noiseBurst(0.22, { filterType: "lowpass", filterFreq: 900, sweepTo: 200, gain: 0.22 });
    tone(220, 0.18, { gain: 0.2, glideTo: 70 });
  }
  function thud() {
    if (!allowed("thud", 120)) return;
    tone(120, 0.2, { gain: 0.3, glideTo: 42 });
    noiseBurst(0.08, { filterType: "lowpass", filterFreq: 260, gain: 0.2 });
  }
  function bump() {
    if (!allowed("bump", 300)) return;
    tone(140, 0.08, { gain: 0.1, glideTo: 80 });
  }
  function whoosh(dur = 0.4, up = true, gain = 0.15) {
    noiseBurst(dur, { filterFreq: up ? 300 : 2500, sweepTo: up ? 2600 : 300, q: 1.2, gain, fadeIn: dur * 0.5 });
  }
  function sparkle() {
    if (!allowed("sparkle", 350)) return;
    [1568, 1976, 2349, 3136].forEach((f, i) => tone(f, 0.18, { gain: 0.06, delay: i * 0.05 }));
  }
  function partyPopper() {
    if (!allowed("party", 200)) return;
    noiseBurst(0.07, { filterType: "highpass", filterFreq: 1200, gain: 0.26 });
    tone(200, 0.1, { gain: 0.2, glideTo: 60 });
    for (let i = 0; i < 7; i++) noiseBurst(0.03, { filterType: "highpass", filterFreq: 4000, gain: 0.05, delay: 0.12 + Math.random() * 0.6 });
  }

  /* -------------------------------------------------------------------- comedy */

  /** "Wah wah wah waaaah" — pass true for the shorter 3-note version. */
  function sadTrombone(short) {
    if (!allowed("trombone", 400)) return;
    const notes = short ? [[233, 0.26], [220, 0.26], [208, 0.7]] : [[233, 0.36], [220, 0.36], [208, 0.36], [196, 1.0]];
    let d = 0;
    notes.forEach(([f, dur], i) => {
      const last = i === notes.length - 1;
      tone(f, dur, {
        type: "sawtooth", gain: 0.16, delay: d, sustain: true,
        vibrato: last ? 6 : 0, vibratoRate: 6, glideTo: last ? f * 0.9 : null,
        filter: { type: "lowpass", freq: 450, to: 1500, q: 2 },
      });
      d += dur + 0.03;
    });
  }
  function uhoh() {
    if (!allowed("uhoh", 200)) return;
    tone(415, 0.13, { type: "triangle", gain: 0.16 });
    tone(311, 0.22, { type: "triangle", gain: 0.16, delay: 0.15 });
  }
  function gasp() {
    noiseBurst(0.5, { filterFreq: 1000, sweepTo: 1900, q: 0.8, gain: 0.12, fadeIn: 0.25 });
  }
  function cymbal() {
    noiseBurst(1.1, { filterType: "highpass", filterFreq: 5000, gain: 0.12 });
  }
  /** Ba-dum-tss! */
  function rimshot() {
    if (!allowed("rimshot", 800)) return;
    tone(190, 0.09, { gain: 0.3, glideTo: 90 });
    tone(150, 0.09, { gain: 0.3, glideTo: 80, delay: 0.14 });
    noiseBurst(0.1, { filterFreq: 2200, gain: 0.2, delay: 0.3 });
    noiseBurst(1.0, { filterType: "highpass", filterFreq: 5500, gain: 0.11, delay: 0.3 });
  }
  /** "Dun dun DUNNNN" for photo finishes. */
  function dramatic() {
    if (!allowed("dramatic", 800)) return;
    const f = { type: "lowpass", freq: 900, q: 1 };
    tone(196, 0.25, { type: "sawtooth", gain: 0.15, filter: f });
    tone(196, 0.25, { type: "sawtooth", gain: 0.15, delay: 0.3, filter: f });
    tone(147, 1.0, { type: "sawtooth", gain: 0.17, delay: 0.6, sustain: true, vibrato: 4, vibratoRate: 6, filter: f });
    gasp();
  }

  /* --------------------------------------------------------------- game / skin FX */

  function beep(step) { tone(step === "go" ? 880 : 440, 0.15, { type: "square", gain: 0.2 }); }

  /** Called by SuspenseFX.countdown for every label: READY! / 3 / 2 / 1 / GO. */
  function countdownStep(label, i, total) {
    if (i === total - 1) {                       // the final "GO!" label
      tone(660, 0.12, { type: "square", gain: 0.15, filter: { type: "lowpass", freq: 2800 } });
      tone(990, 0.3, { type: "square", gain: 0.15, delay: 0.1, filter: { type: "lowpass", freq: 2800 } });
      whoosh(0.35, true, 0.1);
    } else if (isNaN(parseInt(label, 10))) {     // "READY!"
      boing(1.25);
    } else {                                     // 3 … 2 … 1 — each a little higher
      const n = parseInt(label, 10);
      tone(392 + (4 - Math.min(4, n)) * 60, 0.14, { type: "square", gain: 0.13, filter: { type: "lowpass", freq: 2400 } });
    }
  }

  function splash(big) {
    if (!allowed("splash", big ? 0 : 100)) return;
    noiseBurst(big ? 0.22 : 0.12, { filterFreq: big ? 900 : 1400, gain: big ? 0.16 : 0.09 });
  }
  /** Rising crowd murmur for the final stretch. Returns a handle you can stop() early. */
  function crowdSwell(duration = 2.5) {
    if (muted) return { stop() {} };
    const src = noiseBurst(duration, { filterType: "lowpass", filterFreq: 900, gain: 0.1, fadeIn: duration * 0.55 });
    return { stop: () => { try { src && src.stop(); } catch (e) { /* already stopped */ } } };
  }
  function cheer() {
    noiseBurst(1.6, { filterFreq: 1400, q: 0.6, gain: 0.1, fadeIn: 0.25 });
    for (let i = 0; i < 4; i++) {
      tone(rnd(420, 540), rnd(0.5, 0.8), {
        type: "sawtooth", gain: 0.035, glideTo: rnd(700, 900), delay: rnd(0, 0.3),
        filter: { type: "bandpass", freq: 1100, q: 2 },
      });
    }
  }
  /** Winner fanfare (ascending triad + octave, then a bright chord). */
  function fanfare() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.28, { type: "triangle", gain: 0.22, delay: i * 0.11 }));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, 0.7, { type: "triangle", gain: 0.1, delay: 0.5 }));
  }
  /** Full winner moment: whoosh → fanfare → crowd cheer. */
  function winner() {
    if (!allowed("winner", 900)) return;
    whoosh(0.45, true, 0.12);
    fanfare();
    later(cheer, 350);
  }
  function leadChange() {
    if (!allowed("lead", 900)) return;
    tone(880, 0.08, { type: "triangle", gain: 0.09 });
    tone(1175, 0.12, { type: "triangle", gain: 0.09, delay: 0.07 });
  }

  // Spinning wheels / reels
  function tick(p = 1) {
    if (!allowed("tick", 35)) return;
    noiseBurst(0.02, { filterType: "highpass", filterFreq: 3200, gain: 0.09 });
    tone(1300 * p, 0.035, { type: "triangle", gain: 0.09, glideTo: 800 * p });
  }
  function reelTick() {
    if (!allowed("reeltick", 55)) return;
    tone(rnd(600, 900), 0.02, { type: "square", gain: 0.04 });
    noiseBurst(0.015, { filterType: "highpass", filterFreq: 3000, gain: 0.05 });
  }
  function reelStop() {
    if (!allowed("reelstop", 100)) return;
    tone(180, 0.1, { gain: 0.25, glideTo: 80 });
    noiseBurst(0.03, { filterType: "highpass", filterFreq: 2000, gain: 0.12 });
  }
  function lever() {
    tone(90, 0.14, { gain: 0.3, glideTo: 45 });
    noiseBurst(0.05, { filterFreq: 700, gain: 0.15 });
    later(() => boing(0.7), 130);
  }
  function kaChing() {
    if (!allowed("kaching", 300)) return;
    noiseBurst(0.03, { filterType: "highpass", filterFreq: 3000, gain: 0.12 });
    bell(1568, 0.02);
    bell(2093, 0.11);
    for (let i = 0; i < 5; i++) tone(rnd(2500, 4200), 0.05, { type: "triangle", gain: 0.04, delay: 0.2 + Math.random() * 0.4 });
  }
  /** Snare-roll build-up. */
  function drumroll(dur = 1.2) {
    if (!allowed("drumroll", 400)) return;
    const n = Math.floor(dur / 0.04);
    for (let i = 0; i < n; i++) {
      noiseBurst(0.05, { filterFreq: 1800, q: 0.8, gain: 0.03 + 0.1 * (i / n), delay: i * 0.04 });
    }
  }
  function ping(i) {
    if (!allowed("ping", 30)) return;
    const f = PENTA[(i === undefined ? Math.floor(Math.random() * PENTA.length) : Math.abs(Math.floor(i))) % PENTA.length];
    tone(f, 0.35, { gain: 0.13 });
    tone(f * 3, 0.08, { gain: 0.03 });
  }
  function matchWin() {
    tone(880, 0.25, { gain: 0.14 });
    tone(1319, 0.3, { gain: 0.12, delay: 0.09 });
  }
  function flutter() {
    if (!allowed("flutter", 55)) return;
    noiseBurst(0.05, { filterType: "highpass", filterFreq: 2500, gain: 0.07 });
    tone(rnd(900, 1300), 0.03, { type: "triangle", gain: 0.04 });
  }
  function flipReveal() {
    whoosh(0.3, true, 0.16);
    tone(150, 0.16, { gain: 0.28, glideTo: 60, delay: 0.3 });
    noiseBurst(0.04, { filterType: "highpass", filterFreq: 2000, gain: 0.12, delay: 0.3 });
  }
  function deal(team = 0) {
    if (!allowed("deal", 30)) return;
    const f = PENTA[Math.abs(team) % PENTA.length] * 0.75;
    noiseBurst(0.04, { filterType: "highpass", filterFreq: 2500, gain: 0.08 });
    tone(f, 0.12, { type: "triangle", gain: 0.15, glideTo: f * 1.3 });
  }
  function rattle(dur = 0.6) {
    for (let i = 0; i < 12; i++) {
      noiseBurst(0.03, { filterType: "highpass", filterFreq: 2500, gain: 0.05 + Math.random() * 0.05, delay: (i * dur) / 12 });
    }
  }
  function stamp() {
    tone(150, 0.12, { gain: 0.3, glideTo: 70 });
    noiseBurst(0.05, { filterType: "highpass", filterFreq: 1800, gain: 0.15 });
  }
  function answer(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "yes" || k === "do it") { bell(784); bell(1047, 0.12); }
    else if (k === "no" || k === "skip it") {
      const f = { type: "lowpass", freq: 900, q: 1 };
      tone(160, 0.16, { type: "sawtooth", gain: 0.16, filter: f });
      tone(140, 0.24, { type: "sawtooth", gain: 0.16, delay: 0.2, filter: f });
    } else if (k === "maybe") {
      tone(330, 0.7, { gain: 0.15, glideTo: 392, vibrato: 20, vibratoRate: 7 });
    } else sparkle();
  }
  function eliminated() {
    if (!allowed("elim", 250)) return;
    const pick = [() => sadTrombone(true), bonk, () => slideWhistle(900, 150, 0.7), splat, clownHorn];
    pick[Math.floor(Math.random() * pick.length)]();
  }
  function plod(p = 1) {
    if (!allowed("plod", 200)) return;
    tone(140 * p, 0.12, { gain: 0.14, glideTo: 90 * p });
    noiseBurst(0.02, { filterType: "lowpass", filterFreq: 1200, gain: 0.05, delay: 0.02 });
  }
  function rocketLaunch() {
    if (!allowed("rocket", 500)) return;
    noiseBurst(1.8, { filterType: "lowpass", filterFreq: 250, sweepTo: 1400, gain: 0.22, fadeIn: 0.5 });
    tone(55, 1.6, { type: "sawtooth", gain: 0.12, glideTo: 180, filter: { type: "lowpass", freq: 300 } });
    whoosh(1.2, true, 0.1);
  }
  function balloonPop() {
    if (!allowed("balloonpop", 100)) return;
    noiseBurst(0.09, { filterType: "highpass", filterFreq: 700, gain: 0.4 });
    tone(160, 0.12, { gain: 0.25, glideTo: 50 });
  }
  /** Rate-limited so a few dozen surging racers still read as one squeak here and there. */
  function drop() { slideWhistle(1300, 300, 0.55, 0.13); }

  /** Index-page hover previews: each tool card "says" something. */
  function preview(kind) {
    const map = {
      duck: () => quack(1), rocket: () => whoosh(0.35, true, 0.12), turtle: () => plod(0.8),
      ball: () => ping(3), balloon: () => squeak(1.1), wheel: () => { tick(1); later(() => tick(0.9), 90); later(() => tick(0.8), 200); },
      slot: () => kaChing(), card: () => flutter(), team: () => deal(2), bracket: () => matchWin(),
      weighted: () => thud(), elim: () => uhoh(), yesno: () => answer("yes"),
    };
    (map[kind] || hover)();
  }

  /* ---------------------------------------------------------------- page-wide UI */

  function paintFab(btn) {
    btn.textContent = muted ? "🔇" : "🔊";
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.setAttribute("aria-label", muted ? "Sound effects off — click to turn on" : "Sound effects on — click to mute");
    btn.title = muted ? "Sound effects: off" : "Sound effects: on";
    btn.classList.toggle("muted", muted);
  }

  function initUI() {
    const style = document.createElement("style");
    style.textContent = `
      .sfx-fab { position: fixed; right: 16px; bottom: 16px; z-index: 1000; width: 46px; height: 46px; padding: 0;
        border-radius: 50%; border: var(--border, 2px solid #1e2a45); background: var(--paper, #fbf7ee);
        color: var(--ink, #1e2a45); font-size: 20px; line-height: 1; cursor: pointer; display: flex;
        align-items: center; justify-content: center; box-shadow: 3px 3px 0 var(--ink, #1e2a45);
        transition: transform .12s ease, box-shadow .12s ease; }
      .sfx-fab:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink, #1e2a45); }
      .sfx-fab:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink, #1e2a45); }
      .sfx-fab.muted { opacity: .7; }
      @media print { .sfx-fab { display: none; } }
    `;
    document.head.appendChild(style);

    // Pages with their own sound checkbox (duck race) keep it; everyone else gets the floating button.
    if (!document.getElementById("soundToggle")) {
      const fab = document.createElement("button");
      fab.type = "button";
      fab.className = "sfx-fab";
      fab.dataset.sfx = "off";
      paintFab(fab);
      fab.addEventListener("click", () => {
        setMuted(!muted);
        if (!muted) { ensureCtx(); boing(1.2); }
      });
      document.body.appendChild(fab);
    }

    // Unlock audio on the first real gesture anywhere on the page.
    const unlockOnce = () => ensureCtx();
    ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, unlockOnce, { once: true, capture: true, passive: true }));

    const CLICKABLE = "button, .btn, a[href], summary, [role='button']";
    const skip = (el) => !el || el.disabled || el.closest("[data-sfx='off']");

    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest(CLICKABLE);
      if (skip(el)) return;
      ensureCtx();
      click(el.classList.contains("marker") || el.classList.contains("tool-card") ? "primary" : "soft");
    }, true);

    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t && t.matches && t.matches("input[type='checkbox'], input[type='radio']") && !skip(t)) toggle(t.checked);
    }, true);

    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || !t.matches || skip(t)) return;
      if (t.matches("input[type='range']")) {
        const min = Number(t.min || 0), max = Number(t.max || 100);
        slider((Number(t.value) - min) / ((max - min) || 1));
      } else if (t.matches("textarea, input[type='text'], input[type='number'], input:not([type])")) {
        key();
      }
    }, true);

    // Tiny hover bloops (mouse only, and only when moving onto a *new* clickable).
    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest && e.target.closest(CLICKABLE);
      if (skip(el) || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      if (el.dataset && el.dataset.sfxHover === "off") return;
      hover();
    }, true);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initUI);
    else initUI();
  }

  return {
    unlock, isMuted, setMuted,
    // ui
    click, hover, toggle, slider, key,
    // cartoon
    boing, pop, squeak, quack, quackChorus, slideWhistle, clownHorn, bonk, splat, thud, bump, whoosh, sparkle, partyPopper,
    // comedy
    sadTrombone, uhoh, gasp, cymbal, rimshot, dramatic,
    // game
    beep, countdownStep, splash, crowdSwell, cheer, fanfare, winner, leadChange,
    tick, reelTick, reelStop, lever, kaChing, drumroll, ping, matchWin, flutter, flipReveal,
    deal, rattle, stamp, answer, eliminated, plod, rocketLaunch, balloonPop, drop,
    preview,
  };
})();

if (typeof module !== "undefined") module.exports = SoundFX;
