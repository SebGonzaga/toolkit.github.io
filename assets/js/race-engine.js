/**
 * race-engine.js
 * Pure outcome logic shared by every picker skin (ducks, rockets, balls...).
 * A skin only needs to: call RaceEngine.run(names, opts), then animate each
 * entrant toward the finish line according to the returned finishTime — the
 * entrant with the smallest finishTime is the (already-decided) winner.
 */
const RaceEngine = (() => {
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * @param {string[]} names - full roster
   * @param {object} opts
   *   duration: total race length in seconds
   *   noRepeat: boolean
   *   alreadyWon: string[] - names to exclude when noRepeat is on
   *   weights: {name: number} - optional relative odds (default 1 each)
   * @returns {{ order: {name:string, finishTime:number}[], winner: string, eligiblePool: string[] }}
   */
  function run(names, opts = {}) {
    const { duration = 8, noRepeat = false, alreadyWon = [], weights = {} } = opts;

    let pool = names.filter(Boolean);
    if (noRepeat) {
      const remaining = pool.filter((n) => !alreadyWon.includes(n));
      pool = remaining.length ? remaining : pool; // auto-reset once everyone has won
    }

    // Weighted shuffle: duplicate-in-place trick keeps it simple & fair.
    const weighted = [];
    pool.forEach((n) => {
      const w = Math.max(1, Math.round(weights[n] || 1));
      for (let i = 0; i < w; i++) weighted.push(n);
    });
    const shuffledWeighted = shuffle(weighted);
    const rankedUnique = [];
    const seen = new Set();
    for (const n of shuffledWeighted) {
      if (!seen.has(n)) { seen.add(n); rankedUnique.push(n); }
    }
    pool.forEach((n) => { if (!seen.has(n)) rankedUnique.push(n); });

    const n = rankedUnique.length;
    const startFraction = 0.15;   // no one finishes before 15% of the clock
    const usable = duration * 0.7;
    const bandWidth = n > 1 ? usable / n : usable;

    const order = rankedUnique.map((name, i) => {
      const bandStart = duration * startFraction + i * bandWidth;
      const jitter = Math.random() * bandWidth * 0.8;
      return { name, finishTime: +(bandStart + jitter).toFixed(2) };
    });

    return { order, winner: order[0].name, eligiblePool: pool };
  }

  return { run, shuffle };
})();

if (typeof module !== "undefined") module.exports = RaceEngine;
