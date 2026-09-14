/**
 * sound-fx.js
 * Tiny procedurally-synthesized sound effects for race skins — countdown
 * beeps, quacks/splashes, a crowd swell on the final stretch, and a winner
 * fanfare. Everything is generated with Web Audio oscillators/noise buffers
 * at runtime, so there are no external audio files to license or host.
 *
 * Browsers block audio until a user gesture, so call SoundFX.unlock() from
 * inside a click handler (e.g. the "Start" button) before anything plays.
 */
const SoundFX = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem("sfx-muted") === "1"; } catch (e) { /* storage blocked */ }

  // Simple per-effect rate limiting so a 100-duck roster splashing/quacking
  // in a tight loop doesn't turn into a wall of noise — each named effect
  // can only re-fire after its own minimum gap.
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
      master.gain.value = muted ? 0 : 0.65;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /** Call from a user-gesture handler (click) to unlock audio for the session. */
  function unlock() { ensureCtx(); }

  function isMuted() { return muted; }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem("sfx-muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.65, ctx.currentTime, 0.05);
  }

  function tone(freq, dur, opts = {}) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    const { type = "sine", gain = 0.25, glideTo = null, delay = 0 } = opts;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    const t0 = c.currentTime + delay;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noiseBurst(dur, opts = {}) {
    if (muted) return null;
    const c = ensureCtx();
    if (!c) return null;
    const { filterType = "bandpass", filterFreq = 1200, gain = 0.15, fadeIn = 0 } = opts;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filt = c.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = filterFreq;
    const g = c.createGain();
    const t0 = c.currentTime;
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + fadeIn);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
    } else {
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(filt).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    return src;
  }

  /** Countdown beep — pass "go" for the final, higher-pitched hit. */
  function beep(step) {
    tone(step === "go" ? 880 : 440, 0.15, { type: "square", gain: 0.2 });
  }

  /** Cartoon quack: quick downward pitch glide. Rate-limited across all callers. */
  function quack(pitchVariance = 1) {
    if (!allowed("quack", 90)) return;
    tone(300 * pitchVariance, 0.09, { type: "sawtooth", gain: 0.1, glideTo: 160 * pitchVariance });
  }

  /** Short splash noise. Rate-limited so a start-line dive-in doesn't spam. */
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

  /** Short winner fanfare (ascending triad + octave). */
  function fanfare() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, 0.28, { type: "triangle", gain: 0.22, delay: i * 0.11 })
    );
  }

  return { unlock, isMuted, setMuted, beep, quack, splash, crowdSwell, fanfare };
})();

if (typeof module !== "undefined") module.exports = SoundFX;
