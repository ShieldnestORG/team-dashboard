/* VENDORED for the YouTube cast (2026-11-16) from an internal animation kit, lib/character.js at 9459db5; code unchanged (two comment lines that named the kit's private docs were shortened).
 * Keep in step with the kit: copy the file again rather than editing it here. */
/* Character rig (classic script: <script src="/lib/character.js"></script>, after /lib/stage.js).
 * How to make a character with it, and its tests (one per rule, plus mutation tests), live with the kit.
 *
 * Contract: every pose is a PURE function of t. No state is carried between frames: there is no integrator that
 * is stepped once per frame, no "previous pose", nothing random, no clock, no timer, no CSS animation. Secondary motion
 * that needs history (follow-through, drag) is computed from the past of a pure driver:
 *   - follow(): the exact response of Stage.spring to a list of target steps (a sum of spring step responses), or
 *   - lag():    a short re-simulation over the last ~6 time constants, started from a fixed grid, so it is
 *               still a function of t alone.
 * An act may start at a NEGATIVE time, so frame 0 is already mid-move (the first-second rule).
 * This file holds no colours: a face def supplies ink, sclera, hilite and lidColor (kit values), rig() throws if one is missing.
 * Layers: Motion (numbers only, runs in Node), actor (a performance as data -> pose(t)), mount (SVG drawer, shapes only, never text).
 */
(function (root) {
  "use strict";
  const S = root.Stage;
  if (!S) throw new Error("character.js needs /lib/stage.js loaded first");
  const { clamp, mix, seg, ease, spring, rng, loopNoise } = S;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ Motion: pure numbers
  /** Deterministic 0..1 from an integer slot and a seed (blinks, glances): the same slot always gives the same number. */
  const hash01 = (n, seed = 1) => rng(((Math.imul(n | 0, 7919) + Math.imul(seed | 0, 104729)) ^ 0x9e3779b9) >>> 0)();

  /** Pose-to-pose: eased tween between keys [[t, v, ease?], ...]. The ease belongs to the segment that ARRIVES at its key. "hold" = step. */
  function keys(t, K, dflt = ease.inOutCubic) {
    if (t <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i][0]) {
        const [t0, v0] = K[i - 1], [t1, v1, e] = K[i];
        if (e === "hold") return v0;
        return mix(v0, v1, (typeof e === "function" ? e : dflt)(seg(t, t0, t1)));
      }
    }
    return K[K.length - 1][1];
  }

  /**
   * Follow-through for free: the value chases a stepped target [[t, v], ...] like a damped spring. The system is linear, so the
   * response is the first value plus, for every step, (size of the step) x (Stage.spring step response since that step).
   * Exact for one freq/damping (checked against an RK4 integration in test/character.test.mjs).
   */
  function follow(t, K, { freq = 2.5, damping = 0.45 } = {}) {
    let v = K[0][1];
    for (let i = 1; i < K.length; i++) v += (K[i][1] - K[i - 1][1]) * spring(t - K[i][0], { freq, damping });
    return v;
  }

  /**
   * Drag / overlapping action for a CONTINUOUS driver f(t): the value a damped spring would have after chasing f over the
   * last `window` seconds. Re-simulated from a fixed time grid (RK4, dt = 1/120), so it depends on t and f only.
   * The window is 6 decay time constants, so what the start-up guess leaves behind is below 0.3% of the driver's error.
   */
  function lag(f, t, { freq = 2, damping = 0.35, window = null, dt = 1 / 120 } = {}) {
    const w0 = TAU * freq, zw = Math.max(damping * w0, 1e-6);
    const W = window ?? Math.min(6, 6 / zw);
    let s = Math.floor((t - W) / dt) * dt;
    let x = f(s), v = (f(s + dt) - f(s - dt)) / (2 * dt), f0 = x;
    const acc = (fv, xx, vv) => w0 * w0 * (fv - xx) - 2 * damping * w0 * vv;
    while (s < t - 1e-12) {
      const h = Math.min(dt, t - s);
      const fm = f(s + h / 2), f1 = f(s + h);
      const k1x = v, k1v = acc(f0, x, v);
      const k2x = v + (h / 2) * k1v, k2v = acc(fm, x + (h / 2) * k1x, v + (h / 2) * k1v);
      const k3x = v + (h / 2) * k2v, k3v = acc(fm, x + (h / 2) * k2x, v + (h / 2) * k2v);
      const k4x = v + h * k3v, k4v = acc(f1, x + h * k3x, v + h * k3v);
      x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      s += h; f0 = f1;
    }
    return x;
  }

  /** Squash and stretch that keeps the area: s > 0 stretches (taller, thinner), s < 0 squashes. sx * sy === 1. */
  const squash = (s) => { const k = 1 + clamp(s, -0.75, 2); return { sx: 1 / k, sy: k }; };

  /** A point on an arc from a to b; bow in px bends it to the left of travel (up, for left to right). */
  function arc(p, a, b, bow = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, k = Math.sin(Math.PI * p) * bow / L;
    return [mix(a[0], b[0], p) + dy * k, mix(a[1], b[1], p) - dx * k];
  }

  /** Ball bounce, closed form. Released at rest from height h at `at`; the first up-and-down takes T, each bounce keeps e of its speed. y is height above ground. */
  function bounce(t, { at = 0, h = 100, T = 0.5, e = 0.6 } = {}) {
    const u = t - at;
    if (u <= 0) return { y: h, k: -1, since: -1, air: true, end: at + T / 2 + (T * e) / (1 - e) };
    const end = at + T / 2 + (T * e) / (1 - e);
    if (u < T / 2) return { y: h * (1 - Math.pow((2 * u) / T, 2)), k: 0, since: -1, air: true, end };
    const w = u - T / 2, q = (w * (1 - e)) / (T * e);
    if (q >= 1) return { y: 0, k: Infinity, since: t - end, air: false, end };
    const k = Math.floor(Math.log(1 - q) / Math.log(e)) + 1;
    const Sprev = (T * e * (1 - Math.pow(e, k - 1))) / (1 - e), Tk = T * Math.pow(e, k), hk = h * Math.pow(e, 2 * k);
    const p = (w - Sprev) / Tk;
    return { y: 4 * hk * p * (1 - p), k, since: -1, air: true, end };
  }
  /** Times of every ground contact of bounce(), for sound cues. Stops when a flight is shorter than minGap. */
  function bounceContacts({ at = 0, T = 0.5, e = 0.6 } = {}, minGap = 1 / 30) {
    const out = [at + T / 2];
    for (let k = 1; T * Math.pow(e, k) >= minGap; k++) out.push(out[k - 1] + T * Math.pow(e, k));
    return out;
  }

  /**
   * Blink closure 0 (open) .. 1 (shut), stateless: one blink per `every` seconds slot at a hashed offset, sometimes a quick
   * double. Closing is faster than opening (measured on people: closing 40-47% faster, Kwon 2013 / PubMed 18565090).
   * `at` forces blinks (blink to hide an expression change).
   */
  function blink(t, { seed = 1, every = 3.6, close = 0.07, hold = 0.04, open = 0.15, at = [] } = {}) {
    const dur = close + hold + open;
    const one = (t0) => {
      const u = t - t0;
      if (u <= 0 || u >= dur) return 0;
      if (u < close) return ease.inOutSine(u / close);
      if (u < close + hold) return 1;
      return 1 - ease.inOutSine((u - close - hold) / open);
    };
    let c = 0;
    const k = Math.floor(t / every);
    for (let j = k - 1; j <= k; j++) {
      const t0 = j * every + every * (0.1 + 0.75 * hash01(j, seed));
      c = Math.max(c, one(t0));
      if (hash01(j, seed + 977) < 0.15) c = Math.max(c, one(t0 + dur + 0.1));
    }
    for (const a of at) c = Math.max(c, one(a));
    return c;
  }

  /** Smooth value noise at any frequency, -1..1 (for shake). */
  const vnoise = (x, seed) => { const i = Math.floor(x), f = x - i; return mix(hash01(i, seed), hash01(i + 1, seed), S.smoothstep(f)) * 2 - 1; };
  /** Impact shake: trauma^2 x noise, trauma falls 1.4 per second (numbers from threejs-game-skills game-feel.md; ideas only). hits = [{at, trauma}] */
  function shake(t, hits, { max = 14, roll = 0.03, decay = 1.4, hz = 32, seed = 5 } = {}) {
    let tr = 0;
    for (const h of hits) { const u = t - h.at; if (u >= 0) tr += Math.max(0, h.trauma - decay * u); }
    const a = Math.min(1, tr) ** 2;
    return { dx: max * a * vnoise(t * hz, seed), dy: max * a * vnoise(t * hz, seed + 1), rot: roll * a * vnoise(t * hz, seed + 2), trauma: Math.min(1, tr) };
  }

  /** Two-bone reach for arms: root at the origin, target (tx, ty); bend +1 or -1 picks the elbow side. Out of reach = fully stretched toward the target. */
  function ik2(l1, l2, tx, ty, bend = 1) {
    const d = Math.hypot(tx, ty) || 1e-9, dd = clamp(d, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6), base = Math.atan2(ty, tx);
    const a1 = base + bend * Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
    const jx = l1 * Math.cos(a1), jy = l1 * Math.sin(a1), ex = Math.cos(base) * dd, ey = Math.sin(base) * dd;
    return { a1, a2: Math.atan2(ey - jy, ex - jx) - a1, joint: [jx, jy], end: [ex, ey], reached: d <= l1 + l2 };
  }

  /**
   * A gear's angle (radians) as the exact integral of a piecewise-linear speed [[t, rad/s], ...] from angle a0 at the first key.
   * No per-frame integrator: each segment adds w0*e + k*e^2/2 in closed form, so any t is drawn directly. Before the first key
   * the speed is the first one held; after the last key the last one is held.
   */
  function spin(t, K, a0 = 0) {
    if (t <= K[0][0]) return a0 + K[0][1] * (t - K[0][0]);
    let a = a0;
    for (let i = 1; i < K.length; i++) {
      const [t0, w0] = K[i - 1], [t1, w1] = K[i], dt = t1 - t0;
      const e = Math.min(t, t1) - t0, k = dt > 0 ? (w1 - w0) / dt : 0;
      a += w0 * e + 0.5 * k * e * e;
      if (t <= t1) return a;
    }
    return a + K[K.length - 1][1] * (t - K[K.length - 1][0]);
  }

  /**
   * The driven gear's angle from the drive gear's angle `a` (both radians, external mesh). `drive` and `driven` are tooth counts;
   * `axis` is the direction from the drive gear's centre to the driven gear's centre (0 = it sits to the right). The driven gear
   * turns the other way at drive/driven times the speed, and its teeth sit in the drive gear's gaps: with a tooth of the drive gear
   * on the line between the centres, the driven gear has a gap there (half a pitch of phase).
   */
  const mesh = (a, { drive, driven, axis = 0 }) => axis + Math.PI + Math.PI / driven - ((a - axis) * drive) / driven;

  // ------------------------------------------------------------------ faces: parametric, so an expression change can tween and overshoot
  const FACES = {
    calm:    { lid: 1,    squint: 0,    browY: 0,    browTilt: 0,    smile: 0.3,  open: 0,    wide: 0.5,  pupil: 1 },
    happy:   { lid: 0.92, squint: 0.4,  browY: 0.35, browTilt: 0,    smile: 1,    open: 0.5,  wide: 0.85, pupil: 1.1 },
    shock:   { lid: 1.2,  squint: 0,    browY: 1,    browTilt: 0.2,  smile: -0.1, open: 0.95, wide: 0.25, pupil: 0.45 },
    worried: { lid: 1,    squint: 0,    browY: 0.4,  browTilt: 1,    smile: -0.55, open: 0.12, wide: 0.6,  pupil: 0.9 },
    angry:   { lid: 0.72, squint: 0.15, browY: -0.4, browTilt: -1,   smile: -0.6, open: 0.2,  wide: 0.9,  pupil: 0.8 },
    smug:    { lid: 0.55, squint: 0.1,  browY: 0.1,  browTilt: -0.2, smile: 0.7,  open: 0,    wide: 0.9,  pupil: 1 },
    sad:     { lid: 0.7,  squint: 0,    browY: 0.1,  browTilt: 1,    smile: -0.8, open: 0,    wide: 0.5,  pupil: 1.1 },
  };
  const FACE_CH = Object.keys(FACES.calm);

  /** Mouth outline from three numbers: smile -1..1 (frown..grin), open 0..1, wide 0..1. One closed path, fill it dark and stroke it. */
  function mouthPath(smile, open, wide, W = 44, H = 26) {
    const w = (W * (0.45 + 0.55 * clamp(wide, 0, 1))) / 2, y0 = -6 * smile, c = 15 * smile, o = clamp(open, 0, 1.2) * H;
    const f = (n) => Number(n.toFixed(2));
    return `M${f(-w)} ${f(y0)}Q0 ${f(c)} ${f(w)} ${f(y0)}Q0 ${f(c + 2 * o)} ${f(-w)} ${f(y0)}Z`;
  }

  // ------------------------------------------------------------------ acts: a performance as data
  // Every act returns {at, d:[dx,dy], sample(T) -> {p, lift, rot, s, walk?}}. p = progress of its move 0..1 (position is
  // home + sum of d x p, so acts chain), lift = px above the ground, rot = radians, s = squash/stretch amount.
  // `at` may be negative: the act is then already under way at frame 0.
  const ACTS = {
    /** A hop: crouch (anticipation), launch stretch, parabola (arc), landing squash held 2 frames, spring settle (follow-through). */
    hop(m, from, to, ctx) {
      const H = m.height ?? 90, an = m.anticipate ?? 0.17, fl = m.flight ?? 0.42;
      const aC = m.crouch ?? 0.3, aS = m.stretch ?? 0.22, aL = m.impact ?? 0.3, hold = m.hold ?? 0.07;
      const dir = Math.sign(to[0] - from[0]) || 1, t1 = m.at + an, tc = t1 + fl;
      ctx.events.push({ t: t1, kind: "launch" }, { t: tc, kind: "land" });
      return {
        at: m.at, d: [to[0] - from[0], to[1] - from[1]],
        sample(T) {
          const u = seg(T, t1, tc), air = T > t1 && T < tc;
          const crouch = ease.inOutSine(seg(T, m.at, t1)) * (1 - ease.outQuad(seg(T, t1, t1 + 0.05)));
          const stretch = air ? aS * Math.pow(Math.abs(1 - 2 * u), 1.5) : 0;
          const land = T >= tc ? -aL * (1 - spring(T - tc - hold, { freq: 3, damping: 0.3 })) : 0;
          const rot = dir * (-0.1 * crouch + (air ? 0.18 * (1 - 2 * u) : 0));
          return { p: u, lift: 4 * H * u * (1 - u), rot, s: -aC * crouch + stretch + land };
        },
      };
    },
    /** A take (surprise): crouch, snap up in ~2 frames with overshoot, shiver, settle. Also keys the face. */
    take(m, from, to, ctx) {
      const an = m.anticipate ?? 0.1, hold = m.hold ?? 0.5, amt = m.amount ?? 1, ts = m.at + an;
      const K = [[0, 0], [ts, 1], [ts + hold, 0]], sp = { freq: 5.5, damping: 0.32 };
      ctx.events.push({ t: ts, kind: "snap" });
      ctx.faceKeys.push({ at: ts, face: m.face ?? "shock" }, { at: ts + hold, face: m.after ?? "worried" });
      return {
        at: m.at, d: [0, 0],
        sample(T) {
          const crouch = ease.inOutSine(seg(T, m.at, ts)) * (1 - ease.outQuad(seg(T, ts, ts + 0.02)));
          const f = follow(T, K, sp), tremble = T > ts + 0.1 && T < ts + hold ? 0.02 * Math.sin(TAU * 24 * (T - ts)) : 0;
          return { p: 0, lift: 26 * amt * Math.max(f, 0), rot: tremble, s: amt * (0.3 * f - 0.2 * crouch) };
        },
      };
    },
    /** A scuttle/walk: wind-up lean, steps (a bounce per step, waddle left/right), lean into the move, settle. Limbs read `walk`. */
    walk(m, from, to, ctx) {
      const dist = Math.hypot(to[0] - from[0], to[1] - from[1]), P = m.step ?? 0.34, wind = m.windup ?? 0.12, B = m.bounce ?? 10;
      const dur = m.dur ?? dist / (m.speed ?? 260), t0 = m.at + wind, t1 = t0 + dur, dir = Math.sign(to[0] - from[0]) || 1;
      for (let k = 1; t0 + k * P <= t1; k++) ctx.events.push({ t: t0 + k * P, kind: "step" });
      return {
        at: m.at, d: [to[0] - from[0], to[1] - from[1]],
        sample(T) {
          const q = seg(T, t0, t1), p = 0.6 * q + 0.4 * ease.inOutCubic(q);
          const n = (T - t0) / P, env = S.smoothstep(seg(T, t0, t0 + 0.15)) * (1 - S.smoothstep(seg(T, t1 - 0.15, t1)));
          const w = Math.abs(Math.sin(Math.PI * n)) * env, wb = Math.sin((Math.PI * seg(T, m.at, t0))) ;
          return { p, lift: B * w, rot: dir * (0.07 * env - 0.1 * wb * (T < t0 ? 1 : 0)) + 0.05 * Math.sin(Math.PI * n) * env, s: -0.1 * env * (1 - w) ** 2 + 0.06 * w - 0.1 * wb * (T < t0 ? 1 : 0), walk: { n, env } };
        },
      };
    },
    /**
     * A drop: the character falls in from `height` above its spot (released at `at`), lands, and bounces on bounce()'s contact times.
     * It stretches while it falls and squashes on every contact (the first held `hold`, then a spring back), smaller each time.
     * Each contact is a `land` event (level = e^k: how hard it is, 1 for the first). `to` is where it lands; it appears over it at release.
     */
    drop(m, from, to, ctx) {
      const o = { at: m.at, h: m.height ?? 420, T: m.T ?? 0.55, e: m.e ?? 0.38 };
      const aL = m.impact ?? 0.3, aS = m.stretch ?? 0.18, hold = m.hold ?? 0.07, gap = m.minGap ?? 0.12;
      const hits = bounceContacts(o, gap);
      hits.forEach((t, k) => ctx.events.push({ t, kind: "land", level: Math.pow(o.e, k) }));
      return {
        at: m.at, d: [to[0] - from[0], to[1] - from[1]],
        sample(T) {
          const b = bounce(T, o);
          let k = -1;
          for (let i = 0; i < hits.length && T >= hits[i]; i++) k = i;
          let s = 0;
          if (k < 0) s = T > m.at ? aS * seg(T, m.at, hits[0]) : 0;
          else {
            const lv = Math.pow(o.e, k);
            s = -aL * lv * (1 - spring(T - hits[k] - hold, { freq: 3, damping: 0.3 }));
            if (k + 1 < hits.length && T > hits[k] + hold) s += aS * Math.pow(o.e, k + 1) * Math.pow(Math.abs(1 - 2 * seg(T, hits[k], hits[k + 1])), 1.5);
          }
          return { p: T >= m.at ? 1 : 0, lift: b.y, rot: 0, s };
        },
      };
    },
    /**
     * A press: something lands on the character and flattens it (squash to -amount within 2 frames, held for `hold`), then it
     * re-inflates with an overshoot (follow(): a spring step response), so it springs past its own shape before it settles.
     */
    press(m, from, to, ctx) {
      const amt = m.amount ?? 0.3, hold = m.hold ?? 0.6, rel = m.at + hold;
      const sp = m.spring ?? { freq: 4, damping: 0.3 };
      ctx.events.push({ t: m.at, kind: "press" }, { t: rel, kind: "release" });
      return {
        at: m.at, d: [0, 0],
        sample(T) {
          const dn = ease.outQuad(seg(T, m.at, m.at + 2 / 30));
          return { p: 0, lift: 0, rot: 0, s: dn * follow(T, [[0, -amt], [rel, 0]], sp) };
        },
      };
    },
  };

  // ------------------------------------------------------------------ rig + actor
  // A spec that would draw NaN (a typo'd expression, a move with no `at`, a seed that is a string) is refused by name at actor()
  // time: NaN written into an SVG transform is ignored by the browser, so the character just vanishes and every gate stays green.
  const FACE_LEGAL = Object.keys(FACES).join(", ");
  const ACT_PARAMS = { // the numbers each act reads: any finite number, and those that must also be above 0 (a step of 0 never ends)
    hop:   { num: ["height", "anticipate", "flight", "crouch", "stretch", "impact", "hold"], pos: [] },
    take:  { num: ["anticipate", "hold", "amount"], pos: [] },
    walk:  { num: ["dur", "windup", "bounce"], pos: ["step", "speed"] },
    drop:  { num: ["height", "impact", "stretch", "hold"], pos: ["T", "minGap"] },
    press: { num: ["amount", "hold"], pos: [] },
  };
  function checkSpec(R, A) {
    const bad = (msg) => { throw new Error(`actor ${R.id}: ${msg}`); };
    const fin = (v, what) => { if (typeof v !== "number" || !Number.isFinite(v)) bad(`${what} must be a finite number (got ${JSON.stringify(v)})`); };
    const pos = (v, what) => { fin(v, what); if (!(v > 0)) bad(`${what} must be above 0 (got ${v})`); };
    const pt = (v, what) => { if (!Array.isArray(v) || v.length !== 2) bad(`${what} must be [x, y] (got ${JSON.stringify(v)})`); fin(v[0], `${what}[0]`); fin(v[1], `${what}[1]`); };
    const obj = (v, what) => { if (!v || typeof v !== "object" || Array.isArray(v)) bad(`${what} must be an object (got ${JSON.stringify(v)})`); };
    const list = (v, what) => { if (!Array.isArray(v)) bad(`${what} must be an array (got ${JSON.stringify(v)})`); return v; };
    const face = (name, what) => { if (typeof name !== "string" || !Object.hasOwn(FACES, name)) bad(`${what} is ${JSON.stringify(name)}; the expressions are ${FACE_LEGAL}`); };
    const sprg = (sp, what) => { obj(sp, what); if (sp.freq !== undefined) pos(sp.freq, `${what}.freq`); if (sp.damping !== undefined) { fin(sp.damping, `${what}.damping`); if (sp.damping < 0) bad(`${what}.damping must be 0 or more (got ${sp.damping})`); } };
    const keyList = (K, what) => { list(K, what); if (!K.length) bad(`${what} needs at least one key`); K.forEach((k, i) => { if (!Array.isArray(k)) bad(`${what}[${i}] must be [t, value] (got ${JSON.stringify(k)})`); fin(k[0], `${what}[${i}][0]`); fin(k[1], `${what}[${i}][1]`); }); };
    const nums = (o, what, posKeys = [], skip = []) => { obj(o, what); for (const [k, v] of Object.entries(o)) if (!skip.includes(k)) (posKeys.includes(k) ? pos : fin)(v, `${what}.${k}`); };

    pt(A.home, "home"); pos(A.scale, "scale"); fin(A.seed, "seed"); pos(A.fps, "fps");
    if (A.flip !== 1 && A.flip !== -1) bad(`flip must be 1 or -1 (got ${JSON.stringify(A.flip)})`);
    face(A.base, "base");
    sprg(A.faceSpring, "faceSpring");
    if (A.idle != null && A.idle !== false) nums(A.idle, "idle", ["swayPeriod"]);
    if (A.blink != null && A.blink !== false) { nums(A.blink, "blink", ["every"], ["at"]); if (A.blink.at !== undefined) list(A.blink.at, "blink.at").forEach((a, i) => fin(a, `blink.at[${i}]`)); }
    list(A.moves, "moves").forEach((m, i) => {
      const w = `moves[${i}]${m && m.do ? ` (${m.do})` : ""}`;
      obj(m, w);
      if (typeof m.do !== "string" || !Object.hasOwn(ACTS, m.do)) bad(`${w}: unknown act ${JSON.stringify(m.do)} (hop, take, walk, drop, press)`);
      fin(m.at, `${w}.at`);
      if (m.to !== undefined) pt(m.to, `${w}.to`);
      for (const k of ACT_PARAMS[m.do].num) if (m[k] !== undefined) fin(m[k], `${w}.${k}`);
      for (const k of ACT_PARAMS[m.do].pos) if (m[k] !== undefined) pos(m[k], `${w}.${k}`);
      if (m.do === "drop" && m.e !== undefined && !(typeof m.e === "number" && m.e >= 0 && m.e < 1)) bad(`${w}.e must be 0 or more and below 1 (got ${JSON.stringify(m.e)})`);
      if (m.do === "take") { if (m.face !== undefined) face(m.face, `${w}.face`); if (m.after !== undefined) face(m.after, `${w}.after`); }
      if (m.do === "press" && m.spring !== undefined) sprg(m.spring, `${w}.spring`);
    });
    list(A.faces, "faces").forEach((k, i) => {
      const w = `faces[${i}]`;
      obj(k, w); fin(k.at, `${w}.at`);
      if (k.face === undefined && k.with === undefined) bad(`${w} needs a "face" (${FACE_LEGAL}) or a "with"`);
      if (k.face !== undefined) face(k.face, `${w}.face`);
      if (k.with !== undefined) {
        obj(k.with, `${w}.with`);
        for (const [ch, v] of Object.entries(k.with)) { if (!FACE_CH.includes(ch)) bad(`${w}.with has "${ch}"; the channels are ${FACE_CH.join(", ")}`); fin(v, `${w}.with.${ch}`); }
      }
    });
    list(A.looks, "looks").forEach((l, i) => { obj(l, `looks[${i}]`); fin(l.at, `looks[${i}].at`); for (const k of ["x", "y", "dur"]) if (l[k] !== undefined) fin(l[k], `looks[${i}].${k}`); });
    obj(A.tracks, "tracks");
    for (const [name, tr] of Object.entries(A.tracks)) {
      const part = name.endsWith(".rot") ? name.slice(0, -4) : "";
      if (!R.parts.some((p) => p.id === part)) bad(`tracks "${name}" is not "<part id>.rot" of a part of this rig (parts: ${R.parts.map((p) => p.id).join(", ") || "none"})`);
      keyList(Array.isArray(tr) ? tr : tr?.keys, `tracks.${name}${Array.isArray(tr) ? "" : ".keys"}`);
      if (!Array.isArray(tr) && tr.spring !== undefined) sprg(tr.spring, `tracks.${name}.spring`);
    }
    obj(A.spins, "spins");
    for (const [id, sp] of Object.entries(A.spins)) {
      if (!R.parts.some((p) => p.id === id && p.rotor)) bad(`spins names "${id}", which is not a rotor part`);
      if (typeof sp !== "function") { obj(sp, `spins.${id}`); keyList(sp.keys, `spins.${id}.keys`); if (sp.a0 !== undefined) fin(sp.a0, `spins.${id}.a0`); }
    }
  }

  const UID = { n: 0 };
  const EYE_COLOURS = { sclera: ["ink", "sclera", "hilite", "lidColor"], bean: ["ink", "hilite", "lidColor"] };
  /**
   * rig(def): a character as data.
   *   def.parts: [{id, parent ("root" by default), at:[x,y] joint position in the parent, z (-1 = drawn behind its parent's own shapes),
   *                rest:{rot}, shapes:[{d|ellipse|rect, fill, stroke, sw}], walk:{amp, phase}, secondary:{x, y, freq, damping},
   *                rotor: true (a part an actor may spin: a gear's teeth; give it z -1, the face goes on a part that does not turn)}]
   *   def.shapes: the root's own shapes; the root origin is the feet (squash and stretch pivot there).
   *   def.face:   {part, at:[x,y], gap, rx, ry, pr, brow:{len, gap, sw}, mouthY, sw, msw, asym,
   *                eye: "sclera" (white eye, pupil: the default) or "bean" (a solid dark eye, the glint is the looking point),
   *                ink, sclera (not for bean), hilite, lidColor: kit colours, no defaults here}
   */
  function rig(def) {
    const parts = def.parts.map((p) => ({ parent: "root", at: [0, 0], z: 0, rest: {}, shapes: [], ...p }));
    const ids = new Set(["root", ...parts.map((p) => p.id)]);
    for (const p of parts) if (!ids.has(p.parent)) throw new Error(`rig ${def.id}: part ${p.id} has unknown parent ${p.parent}`);
    const face = def.face ?? null;
    if (face) {
      const style = face.eye ?? "sclera";
      if (!EYE_COLOURS[style]) throw new Error(`rig ${def.id}: face.eye is "${style}" (sclera or bean)`);
      for (const k of EYE_COLOURS[style]) if (typeof face[k] !== "string" || !face[k]) throw new Error(`rig ${def.id}: face needs "${k}" (a kit colour; this library holds no colours)`);
      for (const k of ["gap", "rx", "ry", "pr", "mouthY"]) if (!Number.isFinite(face[k])) throw new Error(`rig ${def.id}: face needs a number "${k}" (got ${JSON.stringify(face[k])})`);
      if (!Array.isArray(face.at) || face.at.length !== 2 || !face.at.every(Number.isFinite)) throw new Error(`rig ${def.id}: face.at must be [x, y] (got ${JSON.stringify(face.at)})`);
      if (!face.brow || !Number.isFinite(face.brow.len) || !Number.isFinite(face.brow.gap)) throw new Error(`rig ${def.id}: face.brow must be {len, gap} numbers (got ${JSON.stringify(face.brow)})`);
      for (let id = face.part ?? "root"; id !== "root"; id = parts.find((p) => p.id === id)?.parent ?? "root") {
        if (!ids.has(id)) throw new Error(`rig ${def.id}: face.part ${id} is not a part of this rig`);
        if (parts.find((p) => p.id === id).rotor) throw new Error(`rig ${def.id}: the face is on rotor part ${id} and would turn with it (put it on a part that does not spin)`);
      }
    }
    return { id: def.id ?? "char", def, parts, shapes: def.shapes ?? [], face, size: def.size ?? [200, 200] };
  }

  /**
   * actor(rig, spec): who the character is in this film, as data. Returns {pose(t), spinAngle(part, t), events, cues, mount(svg)}.
   * spec: {home, scale, flip (1 or -1), seed, fps (default 30, only for cues), base (the resting expression), faceSpring, moves, faces, looks,
   *        tracks, spins, idle, blink, noFace}. A spec that would give NaN or never end throws, naming the actor, the field and what is legal.
   * events: [{t, kind, size, level?}] at the exact picture time. cues: [{t, label}] = each event one frame later (sound crests one frame after
   * its picture), events whose cue falls before 0 left out: what Stage.define({cues}) wants.
   */
  function actor(R, spec = {}) {
    const D = { home: [0, 0], scale: 1, flip: 1, seed: 1, fps: 30, base: "calm", moves: [], faces: [], looks: [], tracks: {}, spins: {}, faceSpring: { freq: 4.5, damping: 0.5 } };
    const A = { ...D, ...spec };
    for (const k in D) A[k] ??= D[k];
    checkSpec(R, A);
    const idle = A.idle === false ? null : { breath: 0.018, breathHz: 0.32, sway: 0.02, swayPeriod: 8, drift: 0.12, ...(A.idle ?? {}) };
    const blinkOpts = A.blink === false ? null : { seed: A.seed, ...(A.blink ?? {}) };
    const ctx = { events: [], faceKeys: [] };
    let cur = A.home.slice();
    const acts = [];
    for (const m of [...A.moves].sort((a, b) => a.at - b.at)) {
      const to = m.to ?? cur;
      acts.push(ACTS[m.do](m, cur, to, ctx));
      cur = to;
    }
    // a spin is {keys: [[t, rad/s], ...], a0} (spin()) or a pure function of t returning radians (mesh() of another gear's spinAngle)
    const spins = {};
    for (const [id, sp] of Object.entries(A.spins)) {
      spins[id] = typeof sp === "function" ? sp : (t) => spin(t, sp.keys, sp.a0 ?? 0);
    }
    const spinAngle = (id, t) => (spins[id] ? spins[id](t) : 0);
    const faceKeys = [...A.faces, ...ctx.faceKeys].sort((a, b) => a.at - b.at);
    const look = (axis) => { const K = [[0, 0]]; for (const l of [...A.looks].sort((a, b) => a.at - b.at)) { const prev = K[K.length - 1][1]; K.push([l.at, prev], [l.at + (l.dur ?? 0.07), l[axis] ?? 0, ease.outCubic]); } return K; };
    const lookX = look("x"), lookY = look("y");

    /** Root channels at animation time T (everything the secondary parts and the face are driven from). */
    function rootAt(T, withIdle = true) {
      let x = A.home[0], y = A.home[1], lift = 0, rot = 0, s = 0, walk = null;
      for (const a of acts) {
        const r = a.sample(T);
        x += a.d[0] * r.p; y += a.d[1] * r.p; lift += r.lift ?? 0; rot += r.rot ?? 0; s += r.s ?? 0;
        if (r.walk && (!walk || r.walk.env > walk.env)) walk = r.walk;
      }
      if (idle && withIdle) {
        s += idle.breath * Math.sin(TAU * idle.breathHz * T + A.seed);
        rot += idle.sway * loopNoise(T, idle.swayPeriod, A.seed);
      }
      return { x, y: y - lift * A.scale, lift, rot, s, walk };
    }

    function faceAt(T) {
      const f = {};
      for (const ch of FACE_CH) {
        const K = [[0, FACES[A.base][ch]]];
        for (const k of faceKeys) K.push([k.at, { ...FACES[k.face ?? A.base], ...(k.with ?? {}) }[ch]]);
        f[ch] = follow(T, K, A.faceSpring);
      }
      const dr = idle ? idle.drift : 0;
      f.gx = keys(T, lookX) + dr * loopNoise(T, 5.1, A.seed + 1);
      f.gy = keys(T, lookY) + dr * 0.6 * loopNoise(T, 6.7, A.seed + 2);
      f.blink = blinkOpts ? blink(T, blinkOpts) : 0;
      f.lidEff = f.lid * (1 - f.blink);
      return f;
    }

    function pose(t) {
      const T = t, r = rootAt(T), sq = squash(r.s);
      const out = { t, x: r.x, y: r.y, lift: r.lift * A.scale, rot: r.rot, sx: sq.sx, sy: sq.sy, scale: A.scale, flip: A.flip, s: r.s, parts: {}, face: A.noFace ? null : faceAt(T), grounded: r.lift < 0.5 };
      const px = (tt) => rootAt(tt, false).x, py = (tt) => rootAt(tt, false).y; // position never depends on idle
      for (const p of R.parts) {
        const q = { rot: p.rest.rot ?? 0, x: 0, y: 0, sx: 1, sy: 1 };
        if (p.walk && r.walk) q.rot += p.walk.amp * Math.sin(Math.PI * r.walk.n + Math.PI * (p.walk.phase ?? 0)) * r.walk.env;
        if (p.secondary) {
          const sc = p.secondary, o = { freq: sc.freq ?? 2.4, damping: sc.damping ?? 0.25 };
          if (sc.x) q.rot += sc.x * (r.x - lag(px, T, o));
          if (sc.y) q.rot += sc.y * (r.y - lag(py, T, o));
        }
        const tr = A.tracks[p.id + ".rot"];
        if (tr) q.rot += Array.isArray(tr) ? keys(T, tr) : tr.spring ? follow(T, tr.keys, tr.spring) : keys(T, tr.keys);
        if (p.rotor) q.rot += spinAngle(p.id, T);
        out.parts[p.id] = q;
      }
      return out;
    }

    const events = ctx.events.sort((a, b) => a.t - b.t);
    for (const e of events) e.size = A.scale; // a small character thuds smaller: sound reads this
    const frame = 1 / A.fps;
    const cues = events.filter((e) => e.t + frame >= 0).map((e) => ({ t: e.t + frame, label: `${R.id} ${e.kind}` }));
    return { rig: R, spec: A, pose, spinAngle, events, cues, mount: (svg, o) => mount(svg, R, { pose }, A, o) };
  }

  // ------------------------------------------------------------------ SVG drawer (the only part that touches the DOM; shapes only, never text)
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const num = (n) => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(3)));
  function drawShape(sh, parent) {
    const common = { fill: sh.fill ?? "none", stroke: sh.stroke ?? "none", "stroke-width": sh.sw ?? 0, "stroke-linejoin": "round", "stroke-linecap": "round" };
    if (sh.ellipse) { const [cx, cy, rx, ry] = sh.ellipse; return el("ellipse", { cx, cy, rx, ry, ...common }, parent); }
    if (sh.rect) { const [x, y, w, h, r = 0] = sh.rect; return el("rect", { x, y, width: w, height: h, rx: r, ry: r, ...common }, parent); }
    return el("path", { d: sh.d, ...common }, parent);
  }

  function mount(svg, R, actorLike, A, opt = {}) {
    const uid = ++UID.n, nodes = {};
    const rootG = el("g", { "data-char": R.id, ...(opt.safe ? { "data-safe": opt.safe } : {}) }, svg);
    nodes.root = rootG;
    const kids = {};
    for (const p of R.parts) (kids[p.parent] ??= []).push(p);
    const build = (id, g) => {
      const list = kids[id] ?? [];
      for (const c of list.filter((p) => p.z < 0)) build1(c, g);
      if (id === "root") R.shapes.forEach((sh) => drawShape(sh, g)); else R.parts.find((p) => p.id === id).shapes.forEach((sh) => drawShape(sh, g));
      if (R.face && (R.face.part ?? "root") === id) buildFace(g);
      for (const c of list.filter((p) => p.z >= 0)) build1(c, g);
    };
    const build1 = (p, parentG) => { const g = el("g", {}, parentG); nodes[p.id] = g; build(p.id, g); };
    let face = null;
    function buildFace(g) {
      // an eye is three layers: the eye (sclera, or a solid dark bean), the looking point (a pupil, or the bean's glint), the lid in the body colour;
      // the outline carries data-eye so char-probe.mjs can measure it
      const F = R.face, ink = F.ink, bean = F.eye === "bean", fg = el("g", { transform: `translate(${F.at[0]} ${F.at[1]})` }, g);
      const eyes = [-1, 1].map((side) => {
        const asym = side > 0 ? 1 - (F.asym ?? 0.06) : 1, rx = F.rx * asym, ry = F.ry * asym, id = `cp${uid}${side > 0 ? "r" : "l"}`;
        const eg = el("g", {}, fg);
        const cp = el("clipPath", { id }, eg); el("ellipse", { cx: 0, cy: 0, rx, ry }, cp);
        el("ellipse", { cx: 0, cy: 0, rx, ry, fill: bean ? ink : F.sclera }, eg);
        const inner = el("g", { "clip-path": `url(#${id})` }, eg);
        const pg = el("g", {}, inner), pr = F.pr;
        el("circle", { cx: 0, cy: 0, r: pr, fill: bean ? F.hilite : ink }, pg);
        if (!bean) el("circle", { cx: pr * 0.35, cy: -pr * 0.35, r: pr * 0.3, fill: F.hilite }, pg);
        const lid = el("rect", { x: -rx - 2, y: -ry - 2, width: 2 * rx + 4, height: 0, fill: F.lidColor }, inner);
        const low = el("rect", { x: -rx - 2, y: ry, width: 2 * rx + 4, height: 0, fill: F.lidColor }, inner);
        el("ellipse", { cx: 0, cy: 0, rx, ry, fill: "none", stroke: ink, "stroke-width": F.sw ?? (bean ? 0 : 5), "data-eye": "" }, eg);
        const brow = el("path", { d: `M${-F.brow.len / 2} 0L${F.brow.len / 2} 0`, stroke: ink, "stroke-width": F.brow.sw ?? 7, "stroke-linecap": "round", fill: "none" }, fg);
        return { side, rx, ry, eg, pg, lid, low, brow };
      });
      const mouth = el("path", { d: "", fill: ink, stroke: ink, "stroke-width": F.msw ?? 5, "stroke-linejoin": "round", "stroke-linecap": "round", transform: `translate(0 ${F.mouthY})` }, fg);
      face = { eyes, mouth };
    }
    build("root", rootG);

    function draw(t, o = {}) {
      const P = actorLike.pose(t), hidden = o.visible === false || (opt.show && (t < opt.show[0] || t > opt.show[1]));
      rootG.setAttribute("display", hidden ? "none" : "inline");
      rootG.setAttribute("transform", `translate(${num(P.x)} ${num(P.y)}) rotate(${num((P.rot * 180) / Math.PI)}) scale(${num(P.sx * P.scale * P.flip)} ${num(P.sy * P.scale)})`);
      for (const p of R.parts) {
        const q = P.parts[p.id];
        nodes[p.id].setAttribute("transform", `translate(${p.at[0] + q.x} ${p.at[1] + q.y}) rotate(${num((q.rot * 180) / Math.PI)}) scale(${num(q.sx)} ${num(q.sy)})`);
      }
      if (face && P.face) {
        const f = P.face, F = R.face;
        for (const e of face.eyes) {
          const L = clamp(f.lidEff, 0, 1), bulge = 1 + Math.max(0, f.lid - 1) * 0.6;
          e.eg.setAttribute("transform", `translate(${e.side * F.gap} 0) scale(${num(bulge)})`);
          e.lid.setAttribute("height", num(Math.max(0, 2 * e.ry * (1 - L) + 2)));
          e.low.setAttribute("y", num(e.ry - 2 * e.ry * f.squint * 0.5)); e.low.setAttribute("height", num(2 * e.ry * f.squint * 0.5 + 2));
          const rng_ = Math.max(0, e.rx - F.pr) * 0.8;
          e.pg.setAttribute("transform", `translate(${num(clamp(f.gx, -1, 1) * rng_)} ${num(clamp(f.gy, -1, 1) * Math.max(0, e.ry - F.pr) * 0.8)}) scale(${num(f.pupil)})`);
          const by = -e.ry * bulge - F.brow.gap - f.browY * 14;
          e.brow.setAttribute("transform", `translate(${e.side * F.gap} ${num(by)}) rotate(${num(e.side * f.browTilt * 0.45 * (180 / Math.PI))})`);
        }
        face.mouth.setAttribute("d", mouthPath(f.smile, f.open, f.wide));
      }
      return P;
    }
    return { draw, root: rootG, nodes };
  }

  root.Character = { motion: { keys, follow, lag, squash, arc, bounce, bounceContacts, blink, shake, ik2, spin, mesh, hash01 }, FACES, mouthPath, rig, actor };
})(typeof window !== "undefined" ? window : globalThis);
