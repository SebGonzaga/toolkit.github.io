/**
 * suspense-fx.js
 * Small, dependency-free effects every picker skin can reuse so each one
 * feels alive without re-inventing countdowns/confetti/shake each time.
 * Injects its own <style> once, on first use.
 */
const SuspenseFX = (() => {
  let injected = false;
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
      @media (prefers-reduced-motion: reduce) {
        .fx-shake, .fx-flash, .fx-countdown-num { animation: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Runs a 3-2-1-GO overlay inside `container` (needs position:relative).
   * Returns a Promise that resolves once it's done.
   */
  function countdown(container, labels = ["3", "2", "1", "GO!"]) {
    injectStyles();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "fx-countdown";
      container.appendChild(overlay);
      let i = 0;
      const step = () => {
        overlay.innerHTML = `<span class="fx-countdown-num">${labels[i]}</span>`;
        i++;
        if (i < labels.length) {
          setTimeout(step, i === labels.length - 1 ? 550 : 600);
        } else {
          setTimeout(() => { overlay.remove(); resolve(); }, 380);
        }
      };
      step();
    });
  }

  function shake(el, duration = 420) {
    injectStyles();
    el.classList.remove("fx-shake");
    void el.offsetWidth; // restart animation
    el.classList.add("fx-shake");
    setTimeout(() => el.classList.remove("fx-shake"), duration + 20);
  }

  function flash(el, duration = 500) {
    injectStyles();
    el.classList.remove("fx-flash");
    void el.offsetWidth;
    el.classList.add("fx-flash");
    setTimeout(() => el.classList.remove("fx-flash"), duration + 20);
  }

  function photoFinishBanner(container, text = "Photo finish!") {
    injectStyles();
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

  return { countdown, shake, flash, photoFinishBanner, burst, timeDilation };
})();

if (typeof module !== "undefined") module.exports = SuspenseFX;
