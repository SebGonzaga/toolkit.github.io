/**
 * suspense-fx.js
 * Small, dependency-free effects every picker skin can reuse so each one
 * feels alive without re-inventing countdowns/confetti/shake each time.
 * Injects its own <style> once, on first use.
 */
const SuspenseFX = (() => {
  let injected = false;

  // Optional sound layer: if sound-fx.js is on the page, every effect below
  // gets a matching cartoon sound for free. Pages without it stay silent.
  function sfx(name, ...args) {
    try { if (typeof SoundFX !== "undefined" && SoundFX[name]) SoundFX[name](...args); } catch (e) { /* audio is never critical */ }
  }

  function injectStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement("style");
    style.textContent = `
      .fx-countdown {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        z-index: 40; pointer-events: none; background: rgba(10,12,20,0.28);
        border-radius: inherit;
      }
      .fx-countdown-num {
        font-family: var(--font-display); font-weight: 800; color: #fff;
        font-size: clamp(3.2rem, 10vw, 6rem);
        text-shadow: 0 4px 0 rgba(0,0,0,0.35), 0 0 30px rgba(255,255,255,0.35);
        animation: fx-pop 0.7s cubic-bezier(.2,1.4,.4,1) both;
      }
      .fx-countdown-num.fx-long {
        font-size: clamp(1.7rem, 6.4vw, 3.1rem);
        letter-spacing: 0.03em;
      }
      @keyframes fx-pop {
        0% { transform: scale(0.3); opacity: 0; }
        55% { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .fx-shake { animation: fx-shake 0.42s ease; }
      @keyframes fx-shake {
        0%, 100% { transform: translate(0,0); }
        20% { transform: translate(-6px,2px) rotate(-0.4deg); }
        40% { transform: translate(5px,-3px) rotate(0.4deg); }
        60% { transform: translate(-4px,3px) rotate(-0.3deg); }
        80% { transform: translate(3px,-2px) rotate(0.3deg); }
      }
      .fx-micro-shake { animation: fx-micro-shake 0.22s ease; }
      @keyframes fx-micro-shake {
        0%, 100% { transform: translate(0,0); }
        30% { transform: translate(-2.5px,1px); }
        60% { transform: translate(2px,-1px); }
      }
      .fx-flash { animation: fx-flash 0.5s ease; }
      @keyframes fx-flash {
        0% { filter: brightness(1); }
        30% { filter: brightness(1.7); }
        100% { filter: brightness(1); }
      }
      .fx-photo-banner {
        position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
        background: var(--ink, #1e2a45); color: #fff; font-family: var(--font-display);
        font-weight: 700; font-size: 0.82rem; letter-spacing: 0.06em; text-transform: uppercase;
        padding: 5px 14px; border-radius: 999px; z-index: 30;
        animation: fx-slide-down 0.4s ease both;
      }
      @keyframes fx-slide-down { from { transform: translate(-50%,-14px); opacity: 0; } to { transform: translate(-50%,0); opacity: 1; } }

      /* Camera "push in" during the ready/countdown beat, and a continuous
         mild zoom that can be dialled up as the race heats up. Applied to
         the .field-wrap (or whatever el the caller passes), never the field
         itself, so it composes cleanly with each skin's own zoom classes. */
      .fx-precountdown-zoom { transform: scale(1.025); transition: transform 0.7s cubic-bezier(.2,.7,.3,1); }

      /* Winner spotlight: a dark vignette with a warm pool of light in the
         middle, so the celebrating racer/banner visually "pops" instead of
         just sitting on the same background as the rest of the race. */
      .fx-spotlight {
        position: absolute; inset: 0; z-index: 25; pointer-events: none;
        background: radial-gradient(circle at 50% 55%, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 28%, rgba(8,10,18,0.55) 78%);
        opacity: 0; animation: fx-spotlight-in 1.8s cubic-bezier(.2,.8,.3,1) both;
      }
      @keyframes fx-spotlight-in {
        0% { opacity: 0; }
        18% { opacity: 1; }
        78% { opacity: 1; }
        100% { opacity: 0; }
      }
      .fx-spotlight-beam {
        position: absolute; inset: 0; z-index: 26; pointer-events: none; mix-blend-mode: screen;
        background: conic-gradient(from 200deg at 50% 8%, rgba(255,244,200,0) 0deg, rgba(255,244,200,0.35) 14deg, rgba(255,244,200,0) 30deg, rgba(255,244,200,0) 330deg, rgba(255,244,200,0.35) 346deg, rgba(255,244,200,0) 360deg);
        opacity: 0; animation: fx-spotlight-in 1.8s cubic-bezier(.2,.8,.3,1) both;
      }
      @media (prefers-reduced-motion: reduce) {
        .fx-shake, .fx-micro-shake, .fx-flash, .fx-countdown-num,
        .fx-spotlight, .fx-spotlight-beam, .fx-precountdown-zoom { animation: none !important; transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Runs a READY!/3-2-1-GO overlay inside `container` (needs
   * position:relative). If `zoomEl` is given, it gets a subtle camera
   * "push in" (.fx-precountdown-zoom) for the duration of the countdown —
   * removed as soon as the last label's beat finishes, right as the race
   * itself takes over the zoom. Returns a Promise that resolves once done.
   */
  function countdown(container, labels = ["3", "2", "1", "GO!"], onStep = null, zoomEl = null) {
    injectStyles();
    if (zoomEl) zoomEl.classList.add("fx-precountdown-zoom");
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "fx-countdown";
      container.appendChild(overlay);
      let i = 0;
      const step = () => {
        const label = labels[i];
        const long = String(label).length > 2;
        overlay.innerHTML = `<span class="fx-countdown-num${long ? " fx-long" : ""}">${label}</span>`;
        sfx("countdownStep", label, i, labels.length);
        if (onStep) onStep(label, i);
        i++;
        if (i < labels.length) {
          setTimeout(step, i === labels.length - 1 ? 550 : 600);
        } else {
          setTimeout(() => {
            overlay.remove();
            if (zoomEl) zoomEl.classList.remove("fx-precountdown-zoom");
            resolve();
          }, 380);
        }
      };
      step();
    });
  }

  function shake(el, duration = 420) {
    injectStyles();
    sfx("thud");
    el.classList.remove("fx-shake");
    void el.offsetWidth; // restart animation
    el.classList.add("fx-shake");
    setTimeout(() => el.classList.remove("fx-shake"), duration + 20);
  }

  // A much smaller, quicker shake for mid-race moments — a pack surging
  // together, a lead change — so the camera feels alive without the full
  // finish-line jolt firing every few seconds.
  function microShake(el, duration = 220) {
    injectStyles();
    sfx("bump");
    el.classList.remove("fx-micro-shake");
    void el.offsetWidth;
    el.classList.add("fx-micro-shake");
    setTimeout(() => el.classList.remove("fx-micro-shake"), duration + 20);
  }

  function flash(el, duration = 500) {
    injectStyles();
    sfx("sparkle");
    el.classList.remove("fx-flash");
    void el.offsetWidth;
    el.classList.add("fx-flash");
    setTimeout(() => el.classList.remove("fx-flash"), duration + 20);
  }

  function photoFinishBanner(container, text = "Photo finish!") {
    injectStyles();
    sfx("dramatic");
    const b = document.createElement("div");
    b.className = "fx-photo-banner";
    b.textContent = text;
    container.appendChild(b);
    setTimeout(() => b.remove(), 3200);
  }

  /**
   * Confetti/particle burst radiating out from a point (defaults to center-top
   * of the viewport). shapes: array of css backgrounds/emoji strings optional.
   */
  function burst(x = window.innerWidth / 2, y = window.innerHeight / 3, opts = {}) {
    // Big celebratory bursts get a party popper; the small per-racer ones a plain pop.
    sfx((opts.count || 36) >= 20 ? "partyPopper" : "pop", 1 + Math.random() * 0.4);
    const { count = 36, colors = ["#efb93c", "#d9503f", "#35604a", "#1e2a45", "#8fb9d8", "#c98fd8"], spread = 1 } = opts;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      const size = 6 + Math.random() * 6;
      const isCircle = Math.random() > 0.5;
      el.style.cssText = `position:fixed; top:${y}px; left:${x}px; width:${size}px; height:${size}px;
        background:${colors[i % colors.length]}; z-index:999; pointer-events:none;
        border-radius:${isCircle ? "50%" : "2px"};`;
      document.body.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const dist = (80 + Math.random() * 220) * spread;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 120 - Math.random() * 120;
      const anim = el.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1, offset: 0 },
          { transform: `translate(${dx * 0.6}px, ${dy}px) rotate(${180 + Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy + 420 + Math.random() * 200}px) rotate(${360 + Math.random() * 540}deg)`, opacity: 0, offset: 1 },
        ],
        { duration: 1200 + Math.random() * 900, easing: "cubic-bezier(.25,.46,.45,.94)" }
      );
      anim.onfinish = () => el.remove();
    }
  }

  /**
   * Dims the stage to a vignette with a warm spotlight pool over the middle
   * (where the winner token/banner sits) — call right as a winner is
   * declared, alongside celebrateWinner()/burst(), to make that moment read
   * as a real "big" beat instead of just another animation finishing.
   */
  function winnerSpotlight(container, duration = 1900) {
    injectStyles();
    sfx("winner");
    const dim = document.createElement("div");
    dim.className = "fx-spotlight";
    const beam = document.createElement("div");
    beam.className = "fx-spotlight-beam";
    container.appendChild(dim);
    container.appendChild(beam);
    setTimeout(() => { dim.remove(); beam.remove(); }, duration + 50);
  }

  /**
   * Maps real elapsed time to a "virtual" elapsed time that slows down
   * after a threshold fraction of maxTime — used to stretch out the final
   * stretch of a photo finish into genuine slow motion instead of letting
   * a razor-close finish blur past in a fraction of a second.
   * Does not change who wins — only how the last stretch is paced.
   */
  function timeDilation(rawElapsed, maxTime, opts = {}) {
    const { thresholdFrac = 0.85, rate = 0.35 } = opts;
    const threshold = maxTime * thresholdFrac;
    if (rawElapsed <= threshold) return rawElapsed;
    return threshold + (rawElapsed - threshold) * rate;
  }

  return { countdown, shake, microShake, flash, photoFinishBanner, burst, winnerSpotlight, timeDilation };
})();

if (typeof module !== "undefined") module.exports = SuspenseFX;
