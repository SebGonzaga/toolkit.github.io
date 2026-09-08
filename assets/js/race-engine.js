/**
 * race-engine.js
 * Pure outcome logic shared by every picker skin (ducks, rockets, balls...).
 * A skin only needs to: call RaceEngine.run(names, opts), then animate each
 * entrant toward the finish line using entrant.progressAt(t) -> 0..1 —
 * the entrant with the smallest finishTime is the (already-decided) winner.
 *
 * The curve is NOT a straight line. Each entrant gets a random sequence of
 * surges and stalls so relative position swaps several times mid-race —
 * that's what makes the animation feel alive instead of a predictable bar
 * filling at constant speed. The winner is still fixed the instant run()
 * is called; only the visual journey there is uncertain.
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

  function rand(min, max) { return min + Math.random() * (max - min); }

  /**
   * Build a monotonic progress curve from (0,0) to (finishTime,1) made of
   * several segments with independently randomised time/progress weights,
   * so pace varies (bursts, stalls, comebacks) instead of being linear.
   */
  function buildCurve(finishTime, segments = 6) {
    const timeWeights = Array.from({ length: segments }, () => rand(0.35, 1.6));
    const tTotal = timeWeights.reduce((a, b) => a + b, 0);
    const progWeights = Array.from({ length: segments }, () => rand(0.35, 1.6));
    const pTotal = progWeights.reduce((a, b) => a + b, 0);

    const times = [0];
    const progresses = [0];
    let tAcc = 0, pAcc = 0;
    for (let i = 0; i < segments; i++) {
      tAcc += (timeWeights[i] / tTotal) * finishTime;
      pAcc += progWeights[i] / pTotal;
      times.push(tAcc);
      progresses.push(pAcc);
    }
    // Force a late "final stretch" push so the last leg reads as a sprint,
    // not a coast: compress the second-to-last checkpoint's progress down
    // a little so there's a visible kick right before the line.
    if (segments >= 2) {
      progresses[segments - 1] = Math.min(progresses[segments - 1], rand(0.72, 0.9));
    }
    times[times.length - 1] = finishTime;
    progresses[progresses.length - 1] = 1;

    return { times, progresses };
  }

  function evalCurve(curve, t) {
    const { times, progresses } = curve;
    if (t <= times[0]) return 0;
    const last = times.length - 1;
    if (t >= times[last]) return 1;
    for (let i = 0; i < last; i++) {
      if (t >= times[i] && t <= times[i + 1]) {
        const span = times[i + 1] - times[i] || 1;
        const localT = (t - times[i]) / span;
        const eased = localT * localT * (3 - 2 * localT); // smoothstep
        return progresses[i] + (progresses[i + 1] - progresses[i]) * eased;
      }
    }
    return 1;
  }

  /**
   * @param {string[]} names - full roster
   * @param {object} opts
   *   duration: total race length in seconds
   *   noRepeat: boolean
   *   alreadyWon: string[] - names to exclude when noRepeat is on
   *   weights: {name: number} - optional relative odds (default 1 each)
   * @returns {{ order, winner, eligiblePool, photoFinish, margin }}
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
      const finishTime = +(bandStart + jitter).toFixed(2);
      const curve = buildCurve(finishTime);
      return { name, finishTime, curve, progressAt: (t) => evalCurve(curve, t) };
    });

    const sorted = order.slice().sort((a, b) => a.finishTime - b.finishTime);
    const margin = n > 1 ? sorted[1].finishTime - sorted[0].finishTime : 999;
    const photoFinish = n > 1 && margin <= Math.max(0.35, duration * 0.06);

    return { order, winner: order[0].name, eligiblePool: pool, photoFinish, margin };
  }

  return { run, shuffle, buildCurve, evalCurve };
})();

if (typeof module !== "undefined") module.exports = RaceEngine;
