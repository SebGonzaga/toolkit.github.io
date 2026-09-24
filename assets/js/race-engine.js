/**
 * race-engine.js
 * Pure outcome logic shared by every picker skin (ducks, rockets, turtles...).
 * A skin only needs to: call RaceEngine.run(names, opts), then animate each
 * entrant toward the finish line using entrant.progressAt(t) -> 0..1 —
 * the entrant with the smallest finishTime is the (already-decided) winner.
 *
 * Each entrant is a real velocity/acceleration/drag/stamina simulation
 * (see simulateRacer), not a hand-fitted curve — that's what gives natural
 * acceleration out of the gate, momentum through pace changes, per-racer
 * personality, and organic-looking overtakes instead of a predictable bar
 * filling at constant (or artificially bursty) speed. The winner is still
 * fixed the instant run() is called; only the visual journey there — and
 * the exact instant it happens — falls out of the simulation.
 */
const RaceEngine = (() => {
  const END_BUFFER = 0;             // winner crosses the line exactly when the timer hits 0
  // Slow-mo plays the last 15% of the race at 0.35x, so real time = 0.85 + 0.15/0.35 of the virtual race.
  const SLOWMO_STRETCH = 0.85 + 0.15 / 0.35;

  const DT = 1 / 30;          // simulation step, in seconds of "race time"
  const MAX_STEPS = 6000;     // safety cap (200s of simulated time — never hit in practice)
  const SAMPLE_COUNT = 240;   // resampled points per racer -> O(1) lookup during playback

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
   * One racer's performance profile, all in units of "track lengths per
   * second" on a normalized 0..1 track. `bandBias` comes from the racer's
   * position in the weighted shuffle (0 = the pick that weights/order most
   * favoured) and nudges the *average* max speed down a little for later
   * bands — it sets the odds, it does not fix the outcome. Whether that
   * racer actually wins still falls out of the simulation below, where
   * per-racer randomness plus the low-frequency pace cycle is easily big
   * enough to produce upsets.
   */
  function makeStats(bandBias) {
    return {
      maxSpeed: rand(0.88, 1.06) * bandBias,  // top speed
      acceleration: rand(1.7, 3.3),           // how fast it climbs toward max speed
      drag: rand(0.65, 1.35),                 // how fast it sheds speed when off its target pace
      stamina: rand(0.75, 1.0),               // softens how hard fatigue bites late in the race
    };
  }

  /**
   * A low-frequency "pace state" — SURGE / CRUISE / FATIGUE — that a racer
   * commits to for half a second to a couple of seconds at a time, rather
   * than re-rolling every single frame. That's the difference between
   * "behaviour" and "static": a per-frame `speed += Math.random()*k` reads
   * as jitter no matter how it's tuned, while committing to a mode for a
   * stretch reads as a racer actually deciding to push, coast, or fade.
   * Fatigue gets more likely — and bites harder — the longer the race has
   * gone on, tempered by the racer's own stamina stat.
   */
  function makePacer(stamina) {
    let timer = 0, targetMul = 1, elapsed = 0;
    function next() {
      const r = Math.random();
      const fatigueChance = 0.16 + Math.min(0.22, elapsed * 0.01) * (1 - stamina);
      if (r < 0.24) {
        targetMul = rand(1.06, 1.2); timer = rand(0.4, 1.1);                         // SURGE
      } else if (r < 0.24 + fatigueChance) {
        targetMul = rand(0.68, 0.88) * (0.75 + 0.25 * stamina); timer = rand(0.5, 1.4); // FATIGUE
      } else {
        targetMul = rand(0.95, 1.03); timer = rand(0.7, 1.6);                        // CRUISE
      }
    }
    next();
    return {
      tick(dt) {
        elapsed += dt;
        timer -= dt;
        if (timer <= 0) next();
        return targetMul;
      },
    };
  }

  /**
   * Runs an actual acceleration -> cruise -> fatigue -> recover simulation
   * for one racer over a normalized track of length 1, step by step:
   *   velocity += acceleration * dt   (capped at the pacer's current target)
   *   velocity -= drag * dt           (when easing off pace)
   * Also tracks a smoothly-drifting "lateral" value in [-1, 1] — a cosmetic
   * racing-line wander (nobody actually holds a perfect geometric centre
   * line) that eases toward a slowly-changing target instead of vibrating,
   * so skins can use it for a subtle in-lane drift instead of a dead-straight
   * path. Returns an evenly-time-sampled trace so later lookups are O(1)
   * instead of re-simulating or scanning on every read.
   */
  function simulateRacer(stats) {
    const pacer = makePacer(stats.stamina);
    let t = 0, distance = 0, velocity = 0;
    let lateral = 0, lateralTarget = rand(-0.6, 0.6), lateralTimer = rand(0.6, 1.6);
    const times = [0], distances = [0], laterals = [0];
    let steps = 0;
    while (distance < 1 && steps < MAX_STEPS) {
      steps++;
      const targetSpeed = stats.maxSpeed * pacer.tick(DT);
      if (velocity < targetSpeed) {
        velocity = Math.min(targetSpeed, velocity + stats.acceleration * DT);
      } else if (velocity > targetSpeed) {
        velocity = Math.max(targetSpeed, velocity - stats.drag * DT);
      }
      distance += velocity * DT;
      t += DT;

      lateralTimer -= DT;
      if (lateralTimer <= 0) { lateralTarget = rand(-1, 1); lateralTimer = rand(0.6, 1.8); }
      lateral += (lateralTarget - lateral) * Math.min(1, DT * 1.4);

      times.push(t);
      distances.push(Math.min(distance, 1));
      laterals.push(lateral);
    }
    if (distances[distances.length - 1] < 1) { times.push(t + DT); distances.push(1); laterals.push(lateral); }

    const finishTime = times[times.length - 1];
    const sampledD = new Array(SAMPLE_COUNT + 1);
    const sampledL = new Array(SAMPLE_COUNT + 1);
    let j = 0;
    for (let k = 0; k <= SAMPLE_COUNT; k++) {
      const tk = (k / SAMPLE_COUNT) * finishTime;
      while (j < times.length - 1 && times[j + 1] < tk) j++;
      const jn = Math.min(j + 1, times.length - 1);
      const span = times[jn] - times[j] || 1;
      const localT = Math.min(1, Math.max(0, (tk - times[j]) / span));
      sampledD[k] = distances[j] + (distances[jn] - distances[j]) * localT;
      sampledL[k] = laterals[j] + (laterals[jn] - laterals[j]) * localT;
    }
    return { finishTime, sampledD, sampledL };
  }

  function lookup(samples, finishTime, t) {
    if (t <= 0) return samples[0];
    if (t >= finishTime) return samples[samples.length - 1];
    const idx = (t / finishTime) * SAMPLE_COUNT;
    const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, samples.length - 1);
    return samples[i0] + (samples[i1] - samples[i0]) * (idx - i0);
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

    // Simulate every racer's own raw pace independently — an actual
    // acceleration/drag/stamina run each, not a number fitted to a target
    // time — then treat the time each one takes to cover the normalized
    // track as its "raw" finish time, same role that a formula-based raw
    // time played before.
    const raw = rankedUnique.map((name, i) => {
      const bandBias = 1 - (n > 1 ? (i / (n - 1)) * 0.24 : 0);
      const sim = simulateRacer(makeStats(bandBias));
      return { name, t: sim.finishTime, sim };
    });

    // TIMER CONTRACT: the slider value is the moment the winner is decided.
    // Every finish time is rescaled so the winner crosses the line at
    // (duration - END_BUFFER), so the race ends on `duration` exactly. If the finish is close enough to trigger
    // slow-mo, the slow tail is budgeted into that same total so real elapsed
    // time still equals the slider (see SLOWMO_STRETCH). Scaling time
    // uniformly just speeds up/slows down the same physical run — the
    // acceleration/surge/fatigue/drift shape is untouched — so every
    // playback read below just divides the query time by `scale` before
    // reading back into the already-simulated trace.
    const winnerRaw = Math.min(...raw.map((r) => r.t));
    const sortedRaw = raw.slice().sort((a, b) => a.t - b.t);
    const finishFor = (total) => Math.max(total * 0.5, total - END_BUFFER);
    let scale = finishFor(duration) / winnerRaw;
    const margin = n > 1 ? (sortedRaw[1].t - sortedRaw[0].t) * scale : 999;
    const photoFinish = n > 1 && margin <= Math.max(0.35, duration * 0.06);
    if (photoFinish) scale = finishFor(duration / SLOWMO_STRETCH) / winnerRaw;

    const order = raw.map(({ name, t, sim }) => {
      const finishTime = +(t * scale).toFixed(2);
      const progressAt = (tt) => lookup(sim.sampledD, sim.finishTime, tt / scale);
      const lateralAt = (tt) => lookup(sim.sampledL, sim.finishTime, tt / scale);
      return { name, finishTime, progressAt, lateralAt };
    });
    const sorted = order.slice().sort((a, b) => a.finishTime - b.finishTime);

    return { order, winner: sorted[0].name, eligiblePool: pool, photoFinish, margin, totalTime: duration };
  }

  return { run, shuffle, simulateRacer, SLOWMO_STRETCH };
})();

if (typeof module !== "undefined") module.exports = RaceEngine;
