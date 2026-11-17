/* Explainer scenes for the YouTube cast: one small, wordless picture per spoken line that the gears act out, so the
 * animation explains the line instead of decorating it ("Motivation is a spark that fades": a spark flares above BODY and
 * dies to an ember while BODY droops; "a system is a repeatable process": a loop with dots circling the meshed gears).
 *
 * Classic script, loaded after cast.js; it registers Cast.VIGNETTES and cast.js uses it when present.
 *   pick(text, prev)      which scene a line gets (keyword rules, first match wins, never the same scene twice running)
 *   payoffTime(beat, k)   when the scene's moment lands: the spoken time of its key word (forced-alignment word times)
 *   V[kind].act(h, v)     the gears' part (moves, faces, looks) as plan data: pure, runs in Node
 *   V[kind].speed(v)      optional spin keys for the beat (jammed by friction, racing in a loop, slowing to rest)
 *   V[kind].build(g, v) / draw(st, t, v)   the props, SVG shapes only, in cast space; draw is a pure function of t
 * Props use the channel's colours only (cast.js COL plus muted #A1A1A6 and surface #18181B from scenes.html :root).
 * Cast space (cast.js CLUSTER): BODY's centre (82.6, 82.6), FOCUS (210.2, 124.9), DIRECTION (167.6, 218); the cluster box is
 * 0..273 x 0..274 and list scenes keep 180 px of headroom above it (y down to -180) for the props.
 */
(function (root) {
  "use strict";
  const S = root.Stage, Cast = root.Cast;
  if (!S || !Cast) throw new Error("vignettes.js needs stage.js and cast.js loaded first");
  const { clamp, mix, seg, ease } = S;
  const COL = Cast.COL, MUTED = "#A1A1A6", SURFACE = "#18181B";
  const BODY = [82.6, 82.6], FOCUS = [210.2, 124.9], DIR = [167.6, 218];
  const TAU = Math.PI * 2;
  const f2 = (n) => Math.round(n * 100) / 100;

  // ------------------------------------------------------------------ which scene a line gets (code, not a model)
  // Ordered from the most specific idea to the most general; an explicit comparison ("instead of", "rather than", "vs")
  // shapes the whole line, so it comes right after warnings. Money words switch off "sprout": a growing plant next to
  // staking or rewards would read as a promise of returns (channel rule: no yield, APY or earnings).
  const RULES = [
    ["warning", /\b(scams?|red flags?|risks?|risky|dangers?|dangerous|mistakes?|fail|fails|failed|failure|loss|losses|crash\w*|hack\w*|burnout|intimidating)\b/],
    ["compare", /\b(vs|versus|instead|rather than|compar\w*|difference|choose|choice|not about)\b/],
    ["spark", /\b(motivat\w*|sparks?|inspir\w*|hype|excite\w*|feelings?)\b/],
    ["friction", /\b(friction|obstacles?|resist\w*|barriers?|stuck|struggl\w*|fighting|willpower|debating)\b/],
    ["steps", /\b(small|steps?|tiny|minutes?|starting line|showing up|show up|track record|wins?|restart)\b/],
    ["rest", /\b(rest|resting|sleep\w*|recover\w*|breath\w*|calm\w*|stress\w*|tired|relax\w*|guilt)\b/],
    ["protect", /\b(lock\w*|secur\w*|safe|safety|protect\w*|keys?|custody|seed phrases?|guard\w*)\b/],
    ["wait", /\b(wait\w*|patien\w*|unbond\w*|periods?|delays?|later|over time|in a row|days?)\b/],
    ["loop", /\b(systems?|routines?|habits?|process\w*|repeat\w*|consisten\w*|schedule\w*|automatic\w*|default)\b/],
    ["link", /\b(network\w*|together|communit\w*|people|peers?|groups?|friends?|teams?|validators?|nodes?|connect\w*)\b/],
    ["bulb", /\b(learn\w*|understand\w*|ideas?|clear\w*|realiz\w*|think\w*|mind|mental|focus\w*|identity|decision|design)\b/],
    ["sprout", /\b(grow\w*|build\w*|compound\w*|develop\w*|becom\w*|eventually|confidence|sustainable)\b/],
  ];
  const MONEY = /\b(rewards?|yield\w*|earn\w*|price\w*|returns?|profit\w*|stak\w*|apy|apr|income|money|tokens?|coins?)\b/;

  /** The scene for a line, or null (the gears then just react). Never the scene the previous line had. */
  function pick(text, prev = null) {
    const t = String(text).toLowerCase(), money = MONEY.test(t);
    for (const [kind, re] of RULES) {
      if (kind === prev || (kind === "sprout" && money)) continue;
      if (re.test(t)) return kind;
    }
    return null;
  }

  // the word whose spoken moment the scene's turn lands on; no key word: 55% into the line
  const PAYOFF = {
    spark: /^(fade\w*|unreliable|stops?|gone|wears?|away|feeling\w*|mood)\b/,
    friction: /^(remov\w*|easier|ready|least|lay|setup|following|clear\w*)\b/,
    compare: /^(but|not|instead|rather|than|vs|versus)\b/,
    bulb: /^(design|see|identity|decision|realiz\w*|understand\w*|mind|mental|focus\w*|idea\w*)\b/,
    warning: /^(fail\w*|risk\w*|scams?|loss\w*|burnout|crash\w*|mistakes?|miss\w*)\b/,
    steps: /^(small|minutes?|starting|showing|habit\w*|restart\w*|wins?|confidence)\b/,
  };
  function payoffTime(b, kind) {
    const words = b.words ?? [];
    const re = PAYOFF[kind];
    if (re) {
      // the last match: "a spark that gets you started, but it always fades away" turns on "fades"/"away", not "spark"
      let hit = null;
      for (const w of words) if (re.test(w.w.toLowerCase().replace(/[^a-z']/g, ""))) hit = w;
      if (hit) return clamp(hit.s, b.startSec + 0.6, b.startSec + Math.max(0.7, b.durSec - 0.5));
    }
    return b.startSec + 0.55 * b.durSec;
  }

  // ------------------------------------------------------------------ SVG helpers (props only; the gears are the cast)
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const star = (R, r) => {
    let d = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2, q = i % 2 ? r : R;
      d += `${i ? "L" : "M"}${f2(q * Math.cos(a))} ${f2(q * Math.sin(a))}`;
    }
    return d + "Z";
  };
  const pop = (t, at, dur = 0.35) => ease.outBack(1.8)(clamp((t - at) / dur, 0, 1));
  const tf = (x, y, s = 1, r = 0) => `translate(${f2(x)} ${f2(y)}) rotate(${f2(r)}) scale(${Math.max(0, f2(s * 1000) / 1000)})`;
  // look from a gear's centre toward a cast-space point
  const lookFrom = (c, p) => { const dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy) || 1; return { x: f2((0.9 * dx) / L), y: f2((0.8 * dy) / L) }; };
  const CENTRE = { body: BODY, focus: FOCUS, direction: DIR };
  const lookAll = (h, at, p) => h.ids.forEach((id, i) => h.look(id, at + 0.06 * i, lookFrom(CENTRE[id], p)));

  // ------------------------------------------------------------------ the scenes
  const V = {
    /** A spark flares above BODY and dies to an ember on the key word ("fades"); BODY lights up, then droops. */
    spark: {
      act(h, v) {
        const P = [90, -100];
        lookAll(h, v.a + 0.15, P);
        h.act("body", { at: v.a + 0.15, do: "hop", height: 34 });
        h.face("body", v.a + 0.3, "happy");
        h.face("body", v.k + 0.15, "sad");
        h.face("focus", v.k + 0.25, "worried");
      },
      build(g) {
        const root = el("g", {}, g);
        const ring = el("circle", { r: 1, fill: "none", stroke: COL.coral, "stroke-width": 0.06 }, root);
        const hot = el("path", { d: star(1, 0.32), fill: COL.coral }, root);
        const core = el("circle", { r: 0.32, fill: COL.ink }, root);
        const ember = el("circle", { r: 1, fill: MUTED }, root);
        return { root, ring, hot, core, ember };
      },
      draw(st, t, v) {
        const P = [90, -100], burst = v.a + 0.2, k = v.k;
        const grow = pop(t, burst, 0.4), die = ease.inOutCubic(seg(t, k, k + 0.9));
        const size = 58 * grow * (1 - 0.82 * die), spin = 12 * (t - burst) + 20 * Math.sin(TAU * 0.6 * (t - burst));
        st.hot.setAttribute("transform", tf(P[0], P[1], size, spin));
        st.hot.setAttribute("opacity", f2(1 - die));
        st.core.setAttribute("transform", tf(P[0], P[1], size * (1 + 0.08 * Math.sin(TAU * 2.2 * t)), spin));
        st.core.setAttribute("opacity", f2(1 - die));
        const ringU = seg(t, burst, burst + 0.6);
        st.ring.setAttribute("transform", tf(P[0], P[1], 30 + 70 * ease.outCubic(ringU)));
        st.ring.setAttribute("opacity", f2(ringU > 0 && ringU < 1 ? 0.8 * (1 - ringU) : 0));
        st.ember.setAttribute("transform", tf(P[0], P[1] + 30 * die, 9 * die));
        st.ember.setAttribute("opacity", f2(die * (1 - seg(t, k + 1.4, k + 2.2))));
      },
    },

    /** A loop around the meshed gears with three dots running round it: the same thing, every time, on its own. */
    loop: {
      act(h, v) {
        h.ids.forEach((id, i) => h.face(id, v.a + 0.2 + 0.1 * i, i === 1 ? "smug" : "calm"));
        lookAll(h, v.a + 0.2, [137, -40]);
      },
      speed(v) { return [[v.a + 0.3, 2.2], [v.e - 0.4, 2.2], [v.e - 0.02, 0.5]]; },
      build(g) {
        const root = el("g", {}, g);
        const L = 2 * Math.PI * 155 * (300 / 360);
        const a0 = -Math.PI / 2 + 0.5, a1 = a0 + (300 / 360) * TAU, rx = 150, ry = 145, cx = 140, cy = 118;
        const p0 = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)], p1 = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
        const arc = el("path", { d: `M${f2(p0[0])} ${f2(p0[1])}A${rx} ${ry} 0 1 1 ${f2(p1[0])} ${f2(p1[1])}`, fill: "none", stroke: MUTED, "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": f2(L * 1.2) }, root);
        const tang = Math.atan2(ry * Math.cos(a1), -rx * Math.sin(a1));
        const head = el("path", { d: "M0 0L-22 -13L-22 13Z", fill: MUTED, transform: `translate(${f2(p1[0])} ${f2(p1[1])}) rotate(${f2((tang * 180) / Math.PI)})` }, root);
        const dots = [COL.gold, COL.coral, COL.green].map((c) => el("circle", { r: 12, fill: c }, root));
        return { root, arc, head, dots, L, cx, cy, rx, ry, a0 };
      },
      draw(st, t, v) {
        const u = ease.outCubic(seg(t, v.a + 0.1, v.a + 0.7));
        st.arc.setAttribute("stroke-dashoffset", f2(st.L * 1.2 * (1 - u)));
        st.head.setAttribute("opacity", f2(seg(t, v.a + 0.55, v.a + 0.75)));
        st.dots.forEach((d, i) => {
          const a = st.a0 + 1.9 * (t - v.a) + (i * TAU) / 3;
          d.setAttribute("cx", f2(st.cx + st.rx * Math.cos(a)));
          d.setAttribute("cy", f2(st.cy + st.ry * Math.sin(a)));
          d.setAttribute("opacity", f2(seg(t, v.a + 0.5 + 0.12 * i, v.a + 0.8 + 0.12 * i)));
        });
      },
    },

    /** DIRECTION strains against a rock that jams the gears; on the key word ("remove") the rock pops away and all three spin free. */
    friction: {
      act(h, v) {
        h.act("direction", { at: v.a + 0.1, do: "take", amount: 0.35, hold: Math.max(0.4, v.k - v.a - 0.2), face: "angry", after: "happy" });
        h.face("body", v.a + 0.2, "worried");
        h.face("focus", v.a + 0.25, "worried");
        lookAll(h, v.a + 0.15, [262, 230]);
        h.ids.forEach((id) => h.face(id, v.k + 0.2, "happy"));
        h.act("body", { at: v.k + 0.25, do: "hop", height: 30 });
      },
      speed(v) { return [[v.a + 0.1, 0.03], [v.k, 0.03], [v.k + 0.35, 2.4], [v.e - 0.3, 1.4]]; },
      build(g) {
        const root = el("g", {}, g);
        const rock = el("path", { d: "M-34 22L-38 -6L-18 -30L14 -32L36 -10L34 22Z", fill: SURFACE, stroke: MUTED, "stroke-width": 5, "stroke-linejoin": "round" }, root);
        const crack = el("path", { d: "M-6 -28L2 -10L-8 4L4 20", fill: "none", stroke: MUTED, "stroke-width": 3, "stroke-linecap": "round" }, rock.parentNode);
        const puff = [0, 1, 2].map(() => el("circle", { r: 1, fill: MUTED }, root));
        return { root, rock, crack, puff };
      },
      draw(st, t, v) {
        const P = [252, 236], k = v.k, fly = ease.inCubic(seg(t, k, k + 0.55));
        const jig = t < k ? 2.5 * Math.sin(TAU * 9 * t) * seg(t, v.a + 0.2, v.a + 0.5) : 0;
        const x = P[0] + jig + 170 * fly, y = P[1] - 230 * fly + 140 * fly * fly, r = 260 * fly;
        const s = (1 - 0.5 * fly) * pop(t, v.a, 0.3);
        st.rock.setAttribute("transform", tf(x, y, s, r));
        st.crack.setAttribute("transform", tf(x, y, s, r));
        st.root.setAttribute("opacity", f2(1 - seg(t, k + 0.35, k + 0.6)));
        st.puff.forEach((p, i) => {
          const u = seg(t, k, k + 0.5), a = -0.4 + i * 0.5;
          p.setAttribute("transform", tf(P[0] + 40 * u * Math.cos(a) - 20, P[1] + 30 * u * Math.sin(a), 10 * (1 - u) * (u > 0 ? 1 : 0)));
        });
      },
    },

    /** Small blocks stack into a stair, one at a time, and a check lands on the top one: small wins add up. */
    steps: {
      act(h, v) {
        const n = 4;
        for (let i = 0; i < n; i++) h.look("focus", v.a + 0.3 + (i * (v.e - v.a - 1)) / n, lookFrom(FOCUS, [40 + i * 58, -20 - i * 30]));
        h.face("focus", v.a + 0.3, "calm");
        h.face("body", v.e - 0.8, "happy");
        h.act("body", { at: v.e - 0.85, do: "hop", height: 28 });
        h.face("direction", v.e - 0.7, "happy");
      },
      build(g) {
        const root = el("g", {}, g);
        const blocks = [0, 1, 2, 3].map((i) => el("rect", { x: -25, y: -1, width: 50, height: 1, rx: 6, fill: i === 3 ? COL.coral : COL.gold }, root));
        const check = el("path", { d: "M-16 0L-4 12L18 -14", fill: "none", stroke: COL.ink, "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": 60 }, root);
        return { root, blocks, check };
      },
      draw(st, t, v) {
        const span = v.e - v.a - 1;
        st.blocks.forEach((b, i) => {
          const at = v.a + 0.3 + (i * span) / 4, hgt = 30 * (i + 1), u = pop(t, at, 0.3);
          b.setAttribute("transform", `translate(${40 + i * 58} -12) scale(1 ${f2(u * hgt)})`);
        });
        const cu = ease.outCubic(seg(t, v.e - 0.9, v.e - 0.55));
        st.check.setAttribute("transform", tf(40 + 3 * 58, -12 - 120 - 34, 1));
        st.check.setAttribute("stroke-dashoffset", f2(60 * (1 - cu)));
        st.check.setAttribute("opacity", f2(cu > 0 ? 1 : 0));
      },
    },

    /** A seesaw above the gears weighs two things and tips on the key word ("but", "not", "instead"). */
    compare: {
      act(h, v) {
        lookAll(h, v.a + 0.2, [137, -60]);
        h.face("focus", v.a + 0.25, "worried");
        h.face("focus", v.k + 0.3, "smug");
        h.face("body", v.k + 0.3, "happy");
      },
      build(g) {
        const root = el("g", {}, g);
        const pivot = el("path", { d: "M0 0L-20 34L20 34Z", fill: MUTED, transform: "translate(137 -44)" }, root);
        const beam = el("g", {}, root);
        el("rect", { x: -125, y: -5, width: 250, height: 10, rx: 5, fill: COL.ink }, beam);
        el("circle", { cx: -95, cy: -30, r: 24, fill: COL.gold }, beam);
        el("rect", { x: 72, y: -54, width: 46, height: 46, rx: 8, fill: COL.green }, beam);
        return { root, pivot, beam };
      },
      draw(st, t, v) {
        const k = v.k, wob = 4 * Math.sin(TAU * 0.9 * (t - v.a)) * (1 - seg(t, k - 0.3, k));
        const tilt = 15 * (1 - Math.exp(-6 * Math.max(0, t - k)) * Math.cos(9 * Math.max(0, t - k))) * (t > k ? 1 : 0);
        st.beam.setAttribute("transform", tf(137, -46, pop(t, v.a, 0.3), wob + tilt));
        st.pivot.setAttribute("opacity", f2(seg(t, v.a, v.a + 0.2)));
      },
    },

    /** An hourglass runs out above the gears while they wait: it takes the days it takes. */
    wait: {
      act(h, v) {
        lookAll(h, v.a + 0.2, [137, -100]);
        h.ids.forEach((id) => h.face(id, v.a + 0.3, "calm", { lid: 0.85 }));
      },
      speed(v) { return [[v.a + 0.2, 0.25], [v.e - 0.3, 0.25]]; },
      build(g) {
        const root = el("g", { transform: "translate(137 -110)" }, g);
        const frame = el("g", {}, root);
        el("path", { d: "M-40 -62H40M-40 62H40M-34 -62C-34 -20 -6 -8 -6 0C-6 8 -34 20 -34 62M34 -62C34 -20 6 -8 6 0C6 8 34 20 34 62", fill: "none", stroke: COL.ink, "stroke-width": 6, "stroke-linecap": "round" }, frame);
        const top = el("path", { d: "M-26 -54H26L0 -4Z", fill: COL.gold }, frame);
        const bot = el("path", { d: "M-28 56H28L0 10Z", fill: COL.gold }, frame);
        const stream = el("rect", { x: -2, y: -4, width: 4, height: 58, fill: COL.gold }, frame);
        return { root, frame, top, bot, stream };
      },
      draw(st, t, v) {
        const u = seg(t, v.a + 0.3, v.e - 0.2);
        st.frame.setAttribute("transform", tf(0, 0, pop(t, v.a, 0.35), 3 * Math.sin(TAU * 0.4 * (t - v.a))));
        st.top.setAttribute("transform", `translate(0 -4) scale(${f2(1 - u)}) translate(0 4)`);
        st.bot.setAttribute("transform", `translate(0 56) scale(${f2(u)} ${f2(u)}) translate(0 -56)`);
        st.stream.setAttribute("opacity", f2(u > 0 && u < 1 ? 1 : 0));
      },
    },

    /** A shield closes over the gears with a check: kept safe. */
    protect: {
      act(h, v) {
        lookAll(h, v.a + 0.2, [137, -90]);
        h.ids.forEach((id, i) => h.face(id, v.a + 0.5 + 0.1 * i, i === 0 ? "smug" : "calm"));
      },
      build(g) {
        const root = el("g", {}, g);
        const shield = el("path", { d: "M0 -70L56 -50C56 0 40 40 0 66C-40 40 -56 0 -56 -50Z", fill: SURFACE, stroke: COL.coral, "stroke-width": 8, "stroke-linejoin": "round" }, root);
        const check = el("path", { d: "M-22 -2L-6 14L24 -18", fill: "none", stroke: COL.ink, "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": 70 }, root);
        const ring = el("path", { d: "M0 -70L56 -50C56 0 40 40 0 66C-40 40 -56 0 -56 -50Z", fill: "none", stroke: COL.coral, "stroke-width": 3 }, root);
        return { root, shield, check, ring };
      },
      draw(st, t, v) {
        const s = pop(t, v.a + 0.2, 0.4), cu = ease.outCubic(seg(t, v.a + 0.6, v.a + 0.9)), ru = seg(t, v.k, v.k + 0.7);
        st.shield.setAttribute("transform", tf(137, -96, s));
        st.check.setAttribute("transform", tf(137, -96, s));
        st.check.setAttribute("stroke-dashoffset", f2(70 * (1 - cu)));
        st.ring.setAttribute("transform", tf(137, -96, 1 + 0.6 * ru));
        st.ring.setAttribute("opacity", f2(ru > 0 && ru < 1 ? 0.8 * (1 - ru) : 0));
      },
    },

    /** A warning sign flashes and FOCUS does a double take: watch out for this one. */
    warning: {
      act(h, v) {
        lookAll(h, v.a + 0.15, [137, -96]);
        h.act("focus", { at: v.k - 0.12, do: "take", amount: 0.8, face: "shock", after: "worried" });
        h.face("body", v.k, "worried");
        h.face("direction", v.k + 0.1, "worried");
      },
      build(g) {
        const root = el("g", {}, g);
        const sign = el("g", {}, root);
        el("path", { d: "M0 -58L56 42H-56Z", fill: SURFACE, stroke: COL.coral, "stroke-width": 9, "stroke-linejoin": "round" }, sign);
        el("rect", { x: -6, y: -26, width: 12, height: 40, rx: 6, fill: COL.ink }, sign);
        el("circle", { cx: 0, cy: 28, r: 7, fill: COL.ink }, sign);
        return { root, sign };
      },
      draw(st, t, v) {
        const s = pop(t, v.a + 0.15, 0.35), flash = t > v.k && t < v.k + 0.6 ? 1 + 0.12 * Math.sin(TAU * 5 * (t - v.k)) : 1;
        st.sign.setAttribute("transform", tf(137, -96, s * flash, 4 * Math.sin(TAU * 3 * Math.max(0, t - v.k)) * (1 - seg(t, v.k, v.k + 0.8))));
      },
    },

    /** A bulb above FOCUS lights on the key word: it clicks. */
    bulb: {
      act(h, v) {
        lookAll(h, v.a + 0.2, [210, -70]);
        h.face("focus", v.a + 0.25, "calm", { browY: 0.5 });
        h.act("focus", { at: v.k - 0.1, do: "take", amount: 0.6, face: "shock", after: "happy" });
        h.face("body", v.k + 0.2, "happy");
      },
      build(g) {
        const root = el("g", { transform: "translate(210 -80)" }, g);
        const rays = [0, 1, 2, 3, 4, 5, 6].map((i) => el("rect", { x: -3, y: -94, width: 6, height: 20, rx: 3, fill: COL.gold, transform: `rotate(${-90 + i * 30})` }, root));
        const glass = el("circle", { cx: 0, cy: -20, r: 40, fill: SURFACE, stroke: COL.ink, "stroke-width": 6 }, root);
        const lit = el("circle", { cx: 0, cy: -20, r: 37, fill: COL.gold }, root);
        el("rect", { x: -18, y: 22, width: 36, height: 12, rx: 3, fill: MUTED }, root);
        el("rect", { x: -14, y: 37, width: 28, height: 9, rx: 3, fill: MUTED }, root);
        return { root, rays, glass, lit };
      },
      draw(st, t, v) {
        const on = ease.outCubic(seg(t, v.k, v.k + 0.18));
        st.root.setAttribute("transform", tf(210, -80, pop(t, v.a + 0.1, 0.35)));
        st.lit.setAttribute("opacity", f2(on));
        st.rays.forEach((r, i) => r.setAttribute("opacity", f2(on * (0.6 + 0.4 * Math.sin(TAU * 1.5 * (t - v.k) + i)))));
      },
    },

    /** Lines join the three gears to each other and to three more around them: it works because it is shared. */
    link: {
      act(h, v) {
        h.ids.forEach((id, i) => h.face(id, v.a + 0.3 + 0.1 * i, "happy"));
        h.ids.forEach((id) => h.look(id, v.a + 0.8, { x: 0, y: 0 }));
      },
      build(g) {
        const root = el("g", {}, g);
        const nodes = [[10, -100], [137, -150], [264, -100]];
        const pts = [BODY, FOCUS, DIR];
        const pairs = [[0, 3], [1, 5], [3, 4], [4, 5], [0, 4]];
        const all = [...pts, ...nodes];
        const lines = pairs.map(([i, j]) => {
          const L = Math.hypot(all[j][0] - all[i][0], all[j][1] - all[i][1]);
          return el("line", { x1: all[i][0], y1: all[i][1], x2: all[j][0], y2: all[j][1], stroke: MUTED, "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": f2(L), "data-len": f2(L) }, root);
        });
        const dots = nodes.map((p, i) => el("circle", { cx: p[0], cy: p[1], r: 1, fill: [COL.gold, COL.coral, COL.green][i] }, root));
        return { root, lines, dots, nodes };
      },
      draw(st, t, v) {
        st.lines.forEach((l, i) => {
          const L = Number(l.getAttribute("data-len")), u = ease.outCubic(seg(t, v.a + 0.3 + 0.18 * i, v.a + 0.7 + 0.18 * i));
          l.setAttribute("stroke-dashoffset", f2(L * (1 - u)));
        });
        st.dots.forEach((d, i) => d.setAttribute("r", f2(20 * pop(t, v.a + 0.15 + 0.12 * i, 0.35) * (1 + 0.06 * Math.sin(TAU * 1.2 * t + i)))));
      },
    },

    /** A moon rises, the gears slow almost to a stop and close their eyes: rest is part of it. */
    rest: {
      act(h, v) {
        h.ids.forEach((id, i) => h.face(id, v.a + 0.3 + 0.12 * i, "calm", { lid: 0.3, smile: 0.45 }));
        h.ids.forEach((id) => h.face(id, v.e - 0.35, "calm"));
      },
      speed(v) { return [[v.a + 0.4, 0.06], [v.e - 0.5, 0.06], [v.e - 0.02, 0.6]]; },
      build(g) {
        const root = el("g", {}, g);
        const moon = el("path", { d: "M14 -46A48 48 0 1 0 14 46A38 38 0 1 1 14 -46Z", fill: COL.gold }, root);
        const stars = [[-60, -40], [60, -70], [90, 10]].map(() => el("path", { d: star(1, 0.35), fill: COL.ink }, root));
        return { root, moon, stars };
      },
      draw(st, t, v) {
        const rise = ease.outCubic(seg(t, v.a + 0.1, v.a + 0.9));
        st.moon.setAttribute("transform", tf(60, -60 - 50 * rise, 1, -10 + 10 * rise));
        st.moon.setAttribute("opacity", f2(rise));
        [[-10, -140], [150, -150], [230, -90]].forEach((p, i) => {
          const tw = 0.6 + 0.4 * Math.sin(TAU * 0.8 * t + i * 2);
          st.stars[i].setAttribute("transform", tf(p[0], p[1], 11 * tw * seg(t, v.a + 0.4 + 0.2 * i, v.a + 0.7 + 0.2 * i)));
        });
      },
    },

    /** A sprout grows and opens two leaves beside the gears: it becomes who you are, slowly. */
    sprout: {
      act(h, v) {
        lookAll(h, v.a + 0.2, [250, -80]);
        h.ids.forEach((id) => h.face(id, v.e - 1.0, "happy"));
      },
      build(g) {
        const root = el("g", {}, g);
        el("path", { d: "M-30 0H30L22 34H-22Z", fill: MUTED, transform: "translate(250 -8)" }, root);
        const stem = el("path", { d: "M250 -8C250 -50 244 -90 252 -130", fill: "none", stroke: COL.green, "stroke-width": 9, "stroke-linecap": "round", "stroke-dasharray": 130 }, root);
        const leafL = el("path", { d: "M0 0C-22 -8 -44 -2 -54 14C-34 22 -12 16 0 0Z", fill: COL.green }, root);
        const leafR = el("path", { d: "M0 0C22 -8 44 -2 54 14C34 22 12 16 0 0Z", fill: COL.green }, root);
        return { root, stem, leafL, leafR };
      },
      draw(st, t, v) {
        const span = v.e - v.a, g1 = ease.outCubic(seg(t, v.a + 0.2, v.a + 0.2 + 0.5 * span));
        st.stem.setAttribute("stroke-dashoffset", f2(130 * (1 - g1)));
        const l1 = pop(t, v.a + 0.2 + 0.35 * span, 0.4), l2 = pop(t, v.a + 0.2 + 0.55 * span, 0.4);
        st.leafL.setAttribute("transform", tf(250, -80, l1, -10));
        st.leafR.setAttribute("transform", tf(252, -112, l2, 10));
      },
    },
  };

  // every scene shows from 0.05 s before its line to 0.3 s after it, fading in and out (pure in t)
  const showAt = (t, v) => clamp(seg(t, v.a - 0.05, v.a + 0.2) * (1 - seg(t, v.e, v.e + 0.3)), 0, 1);

  Cast.VIGNETTES = { RULES, MONEY, pick, payoffTime, V, showAt, KINDS: Object.keys(V) };
})(typeof window !== "undefined" ? window : globalThis);
