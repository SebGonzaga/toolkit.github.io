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
      return { el, entrant, prevLeft: 0, badgeEl: el.querySelector(".rank-badge") };
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

    function update(elapsed) {
      const trackW = fieldEl.clientWidth;
      let leaderIdx = 0, leaderProgress = -1, maxProgress = 0;

      const ranked = tokens
        .map((tok, i) => {
          const progress = tok.entrant.progressAt(elapsed);
          maxProgress = Math.max(maxProgress, progress);
          const usable = Math.max(trackW - tok.el.offsetWidth, 0);
          const left = progress * usable;
          const delta = left - tok.prevLeft;
          tok.el.style.left = `${left}px`;
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

      const now = performance.now();
      if (leaderboardEl && now - lastLbUpdate > 140) {
        lastLbUpdate = now;
        ranked.forEach((r, rank) => {
          const row = rows[r.i];
          if (row) {
            row.style.top = `${rank * rowH}px`;
            row.classList.toggle("leader", rank === 0);
          }
        });
      }

      return { leaderIdx, maxProgress, ranked };
    }

    function setZoom(on) {
      fieldEl.classList.toggle("zoom", !!on);
    }

    return { tokens, rows, update, setZoom };
  }

  return { assignLanes, buildField, shuffle };
})();

if (typeof module !== "undefined") module.exports = SharedTrack;
