/**
 * shared-track.js
 * Renders every racer on ONE shared track instead of a stacked row-per-name
 * list. Riders are scattered across the track's height in a stable,
 * shuffled "pack" (so they can visually pass each other), and a compact
 * live leaderboard — not a wall of bars — shows who's ahead.
 */
const SharedTrack = (() => {
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Stratified + shuffled vertical slots: riders spread evenly across the
  // track's height, but which slot the eventual leader lands in is random,
  // so the field doesn't read as "row order = finish order".
  function assignLanes(n) {
    const slots = shuffle(Array.from({ length: n }, (_, i) => i));
    return slots.map((slot) => (slot + 0.5) / n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /**
   * @param {HTMLElement} tokensEl - container for the tokens (position:relative/absolute), cleared each build
   * @param {HTMLElement|null} leaderboardEl - side panel container for ranked rows (cleared each build)
   * @param {Array<{name:string, finishTime:number, progressAt:Function}>} entrants
   * @param {object} opts
   *   tokenHTML(entrant, color, idx) -> inner HTML string for one token's art
   *   palette: string[] of colors, cycled per entrant
   *   manyThreshold: number of entrants above which things shrink (default 14)
   * @returns {{ tokens, update(elapsed), setZoom(bool) }}
   */
  function buildField(tokensEl, leaderboardEl, entrants, opts = {}) {
    const { tokenHTML, palette = ["#35604a"], manyThreshold = 14 } = opts;
    const n = entrants.length;
    const many = n > manyThreshold;
    const fieldEl = tokensEl.closest(".field") || tokensEl;

    tokensEl.innerHTML = "";
    fieldEl.classList.toggle("many-names", many);
    if (leaderboardEl) {
      leaderboardEl.innerHTML = "";
      const panel = leaderboardEl.closest(".leaderboard-panel") || leaderboardEl;
      panel.classList.toggle("many-names", many);
    }

    const laneYs = assignLanes(n);
    const showNamesAlways = n <= 10;

    const trackW = fieldEl.clientWidth;

    // Build a Web Animations API Animation straight from buildCurve's own
    // checkpoints: each (time, progress) pair becomes a keyframe offset/value,
    // so the browser (not our rAF loop) owns interpolation, easing, pausing,
    // and slow-motion (via playbackRate) for the actual on-screen motion.
    // Preview/idle entrants (no curve yet) get no animation and just sit at
    // their CSS default `left: 0`.
    function buildAnim(el, entrant) {
      const curve = entrant.curve;
      if (!curve || !entrant.finishTime) return null;
      const tokenWidth = el.offsetWidth || 34;
      const usablePct = trackW > 0 ? ((trackW - tokenWidth) / trackW) * 100 : 100;
      const keyframes = curve.times.map((t, idx) => ({
        left: `${(curve.progresses[idx] * usablePct).toFixed(3)}%`,
        offset: idx === 0 ? 0 : idx === curve.times.length - 1 ? 1 : Math.min(1, t / entrant.finishTime),
        easing: "ease-in-out",
      }));
      const anim = el.animate(keyframes, {
        duration: Math.max(entrant.finishTime * 1000, 1),
        fill: "forwards",
      });
      anim.pause(); // held at the start until track.play() is called (post-countdown)
      return anim;
    }

    const tokens = entrants.map((entrant, i) => {
      const color = palette[i % palette.length];
      const el = document.createElement("div");
      el.className = "field-token" + (showNamesAlways ? " always-visible" : "");
      el.tabIndex = 0;
      el.style.setProperty("--c", color);
      el.style.top = `${(laneYs[i] * 84 + 8).toFixed(2)}%`;
      el.style.animationDelay = `-${(Math.random() * 2).toFixed(2)}s`;
      el.innerHTML = `
        <span class="rank-badge"></span>
        <span class="token-art">${tokenHTML(entrant, color, i)}</span>
        <span class="name-tag">${escapeHtml(entrant.name)}</span>
      `;
      tokensEl.appendChild(el);
      const anim = buildAnim(el, entrant);
      return { el, entrant, prevLeft: 0, badgeEl: el.querySelector(".rank-badge"), anim };
    });

    const rows = [];
    const rowH = many ? 19 : 26;
    if (leaderboardEl) {
      entrants.forEach((entrant, i) => {
        const color = palette[i % palette.length];
        const row = document.createElement("div");
        row.className = "lb-row";
        row.style.top = `${i * rowH}px`;
        row.innerHTML = `
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-dot" style="--c:${color}"></span>
          <span class="lb-name">${escapeHtml(entrant.name)}</span>`;
        leaderboardEl.appendChild(row);
        rows.push(row);
      });
      leaderboardEl.style.height = `${n * rowH}px`;
    }

    let lastLbUpdate = 0;
    let prevLeaderIdx = -1;

    // elapsed is now only a fallback for tokens with no animation (idle/preview
    // state). Racing tokens report their own currentTime, which the browser
    // keeps accurate through play/pause/playbackRate changes automatically —
    // so ranking, wake trails, etc. stay in sync with slow-mo with no extra
    // time-remapping math required on our end.
    function update(elapsed) {
      const liveTrackW = fieldEl.clientWidth;
      let leaderIdx = 0, leaderProgress = -1, maxProgress = 0;

      const ranked = tokens
        .map((tok, i) => {
          const t = tok.anim ? tok.anim.currentTime / 1000 : elapsed;
          const progress = tok.entrant.progressAt(t);
          maxProgress = Math.max(maxProgress, progress);
          // Virtual position, used only to classify surge/stall and to size
          // the wake trail — the actual on-screen `left` is owned by the
          // Animation itself now, so we never write to tok.el.style here.
          const usable = Math.max(liveTrackW - tok.el.offsetWidth, 0);
          const left = progress * usable;
          const delta = left - tok.prevLeft;
          tok.el.classList.toggle("surging", delta > 1.6);
          tok.el.classList.toggle("stalled", delta < 0.05);
          tok.prevLeft = left;
          if (progress > leaderProgress) { leaderProgress = progress; leaderIdx = i; }
          return { i, progress };
        })
        .sort((a, b) => b.progress - a.progress);

      tokens.forEach((tok, i) => {
        tok.el.classList.remove("rank-1", "rank-2", "rank-3");
        if (tok.badgeEl) tok.badgeEl.textContent = "";
        tok.el.classList.toggle("leading", i === leaderIdx);
      });
      ranked.slice(0, 3).forEach((r, rank) => {
        const tok = tokens[r.i];
        tok.el.classList.add(`rank-${rank + 1}`);
        if (tok.badgeEl) tok.badgeEl.textContent = String(rank + 1);
      });

      // Overtake flash: when the lead changes hands, give the new leader a
      // quick glow instead of letting the swap happen silently.
      if (prevLeaderIdx !== -1 && leaderIdx !== prevLeaderIdx) {
        const tok = tokens[leaderIdx].el;
        tok.classList.remove("lead-change");
        void tok.offsetWidth;
        tok.classList.add("lead-change");
      }
      prevLeaderIdx = leaderIdx;

      const now = performance.now();
      if (leaderboardEl && now - lastLbUpdate > 140) {
        lastLbUpdate = now;
        ranked.forEach((r, rank) => {
          const row = rows[r.i];
          if (row) {
            const wasLeader = row.classList.contains("leader");
            row.style.top = `${rank * rowH}px`;
            row.classList.toggle("leader", rank === 0);
            if (rank === 0 && !wasLeader) {
              row.classList.remove("lead-change");
              void row.offsetWidth;
              row.classList.add("lead-change");
            }
          }
        });
      }

      return { leaderIdx, maxProgress, ranked };
    }

    function setZoom(on) {
      fieldEl.classList.toggle("zoom", !!on);
    }

    // Marks the winning token so it can celebrate (bounce + glow) while the
    // winner banner animates in, instead of just sitting still.
    function celebrateWinner(name) {
      const tok = tokens.find((t) => t.entrant.name === name);
      if (tok) tok.el.classList.add("winner-token");
    }

    // Starts every token's animation at once (call right after the countdown
    // resolves). Replaces the old "requestAnimationFrame + manually compute
    // elapsed" approach to actually beginning the race.
    function play() {
      tokens.forEach((tok) => tok.anim && tok.anim.play());
    }

    // Real slow motion via the browser's own timing model, applied to every
    // token at once so the whole field decelerates together — replaces
    // SuspenseFX.timeDilation's manual input-time remap for actual motion.
    function setPlaybackRate(rate) {
      tokens.forEach((tok) => {
        if (!tok.anim) return;
        if (tok.anim.updatePlaybackRate) tok.anim.updatePlaybackRate(rate);
        else tok.anim.playbackRate = rate;
      });
    }

    // Resolves once every token's animation has actually finished, so the
    // caller can detect race-end from the real animations instead of
    // guessing a "maxTime + buffer" cutoff.
    function finished() {
      const promises = tokens.filter((t) => t.anim).map((t) => t.anim.finished);
      return Promise.all(promises).catch(() => {});
    }

    // Cancels any in-flight animations from this field before it's torn down
    // (e.g. when a new race is built) so old tokens don't keep animating
    // detached from the DOM.
    function destroy() {
      tokens.forEach((tok) => tok.anim && tok.anim.cancel());
    }

    return { tokens, rows, update, setZoom, celebrateWinner, play, setPlaybackRate, finished, destroy };
  }

  return { assignLanes, buildField, shuffle };
})();

if (typeof module !== "undefined") module.exports = SharedTrack;
