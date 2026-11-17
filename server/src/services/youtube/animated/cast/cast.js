/* Coherence Daddy cast for the animated daily video (YT_CAST_PILLARS, off by default).
 *
 * Three gears with faces, BODY (coral, 24 teeth), FOCUS (gold, 18) and DIRECTION (green, 14), drawn from the brand's
 * three-gears character sheet, meshed so they turn together. They never speak: they react to the narration (they drop in,
 * hop on a new section, take a surprise on a number, look at the line being read, settle calm on the closing thought) and
 * keep out of the text's way. Plus a synthesized music bed under Mark's voice: chords that restart on every section, a soft
 * pulse in the sections, a lift on the takeaways, pad only under the quote, a resolve on the end card.
 *
 * Classic script, loaded after stage.js and character.js (both vendored beside this file).
 * Two layers:
 *   - plan (pure data, also runs in Node: server/src/__tests__/youtube-cast.test.ts): placeFor(), plan(), groupAt(), bedPlan().
 *   - page (DOM): mount() measures where each scene's text is, mounts the SVG, draw(t), renderBed(), bedChunk().
 * Contract, same as scenes.html: everything on screen is a pure function of t (no clock, no random, no state between frames).
 */
(function (root) {
  "use strict";
  const S = root.Stage, C = root.Character;
  if (!S || !C) throw new Error("cast.js needs stage.js and character.js loaded first");
  const { clamp, mix, seg, ease } = S;
  const M = C.motion;

  // ------------------------------------------------------------------ brand
  // The channel's colours (scenes.html :root and the coherencedaddy DESIGN dimension palette). Nothing else is drawn.
  const COL = { canvas: "#0E0E10", ink: "#F2F1ED", coral: "#FF6B4A", gold: "#C8A96E", green: "#4A9D7C" };
  const SHADE = "rgba(14, 14, 16, 0.38)", RIVET = "rgba(14, 14, 16, 0.42)", RING = "rgba(14, 14, 16, 0.5)";

  // ------------------------------------------------------------------ the three gears
  // Every rig is drawn at BODY's pitch radius and the actor's scale (N / 24) shrinks FOCUS and DIRECTION, so all three share
  // one face size and one tooth module (6.4 px at scale 1), and so they mesh. Geometry as on the character sheet.
  const RP = 76.8, MODULE = 6.4;
  const GEARS = [
    { id: "body", N: 24, col: COL.coral },
    { id: "focus", N: 18, col: COL.gold },
    { id: "direction", N: 14, col: COL.green },
  ];
  const AX_BF = 0.32, AX_FD = 2.0; // direction BODY -> FOCUS and FOCUS -> DIRECTION (radians, y down), the sheet's "all three" panel
  const f2 = (n) => Math.round(n * 100) / 100;

  function gearPath(N, rp) {
    const m = (2 * rp) / N, ro = rp + 0.9 * m, rr = rp - 1.2 * m, pitch = (2 * Math.PI) / N;
    const P = (r, a) => [f2(r * Math.cos(a)), f2(r * Math.sin(a))];
    let d = "";
    for (let i = 0; i < N; i++) {
      const th = i * pitch;
      const a = P(rr, th - 0.33 * pitch), b = P(ro, th - 0.16 * pitch), c = P(ro, th + 0.16 * pitch), e = P(rr, th + 0.33 * pitch);
      const nx = P(rr, th + 0.67 * pitch);
      d += (i === 0 ? `M${a[0]} ${a[1]}` : "") + ` L${b[0]} ${b[1]} L${c[0]} ${c[1]} L${e[0]} ${e[1]} A${f2(rr)} ${f2(rr)} 0 0 1 ${nx[0]} ${nx[1]}`;
    }
    return { d: d + " Z", m, ro, rr };
  }

  function gearRig(g) {
    const p = gearPath(g.N, RP), R = p.rr - 0.19 * RP, teeth = { d: p.d, fill: g.col, stroke: g.col, sw: f2(0.55 * p.m) };
    const rivets = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
      const a = (k * Math.PI) / 4 + 0.2, r = (p.rr + R) / 2, s = (p.rr - R) * 0.17;
      return { ellipse: [f2(r * Math.cos(a)), f2(r * Math.sin(a)), f2(s), f2(s)], fill: RIVET };
    });
    const er = 0.31 * R;
    return C.rig({
      id: g.id,
      shapes: [],
      parts: [
        // the rim's thickness: the same teeth a little lower, shaded; it turns with the rim
        { id: "depth", at: [0, f2(-p.ro + 0.9 * p.m)], z: -1, rotor: true, shapes: [teeth, { d: p.d, fill: SHADE, stroke: SHADE, sw: teeth.sw }] },
        { id: "rotor", at: [0, f2(-p.ro)], z: -1, rotor: true, shapes: [teeth, ...rivets] },
        // the face plate does not turn
        { id: "plate", at: [0, f2(-p.ro)], shapes: [{ ellipse: [0, 0, f2(R + 3), f2(R + 3)], fill: RING }, { ellipse: [0, 0, f2(R), f2(R)], fill: g.col }] },
      ],
      face: {
        part: "plate", at: [0, f2(-0.08 * R)], gap: f2(0.4 * R), rx: f2(er), ry: f2(er * 1.08), pr: f2(er * 0.46), sw: f2(0.05 * R),
        brow: { len: f2(0.42 * R), gap: f2(0.14 * R), sw: f2(0.085 * R) }, mouthY: f2(0.42 * R), msw: f2(0.06 * R),
        eye: "sclera", ink: COL.canvas, sclera: COL.ink, hilite: COL.ink, lidColor: g.col,
      },
      size: [f2(2 * p.ro), f2(2 * p.ro)],
    });
  }

  // Centres in cast space (the cluster's box starts at 0,0); the depth rim adds 0.9 module below each gear.
  const CLUSTER = (() => {
    const rp = GEARS.map((g) => (g.N * MODULE) / 2), ro = rp.map((r) => r + 0.9 * MODULE);
    const c = [[0, 0]];
    c[1] = [c[0][0] + (rp[0] + rp[1]) * Math.cos(AX_BF), c[0][1] + (rp[0] + rp[1]) * Math.sin(AX_BF)];
    c[2] = [c[1][0] + (rp[1] + rp[2]) * Math.cos(AX_FD), c[1][1] + (rp[1] + rp[2]) * Math.sin(AX_FD)];
    const x0 = Math.min(...c.map((p, i) => p[0] - ro[i])), y0 = Math.min(...c.map((p, i) => p[1] - ro[i]));
    const x1 = Math.max(...c.map((p, i) => p[0] + ro[i])), y1 = Math.max(...c.map((p, i) => p[1] + ro[i] + 0.9 * MODULE));
    const centres = c.map((p) => [f2(p[0] - x0), f2(p[1] - y0)]);
    return { centres, ro, scale: GEARS.map((g) => g.N / 24), w: f2(x1 - x0), h: f2(y1 - y0) };
  })();
  const HEAD = 90; // headroom above the cluster (cast space) for hops and the drop-in

  // ------------------------------------------------------------------ where the cast stands in each scene
  // Candidate spots per scene kind, best first, each with the largest scale it may take. A spot is used only where the cast's
  // box (headroom included) touches no text of that scene (inflated by MARGIN px); the largest fitting scale wins. Between
  // two list scenes the previous spot is kept when it still fits and nothing is clearly bigger (no needless jumps); a section
  // card or the end card always takes its own, bigger spot. Nowhere fits: the cast steps off the bottom edge.
  const W = 1920, H = 1080, MARGIN = 26, MIN_SCALE = 0.6;
  const SPOTS = {
    title: [["rc", 1.25], ["br", 1.0], ["tr", 1.0]],
    section: [["rc", 1.7], ["bm", 1.5], ["br", 1.4]],
    list: [["bl", 1.25], ["br", 1.0], ["tr", 0.9]],
    quote: [["br", 1.2], ["rc", 1.2], ["tr", 1.0]],
    cta: [["rc", 1.5], ["br", 1.2]],
  };
  function spotBox(anchor, s) {
    const w = CLUSTER.w * s, h = (CLUSTER.h + HEAD) * s;
    const x = anchor === "bl" ? 48 : anchor === "bm" ? (W - w) / 2 : W - (anchor === "rc" ? 96 : 48) - w;
    const top = anchor === "tr" ? 36 : anchor === "rc" ? (H - h) / 2 : H - 28 - h;
    return { x, top, w, h, y: top + HEAD * s }; // y: where cast-space y = 0 lands
  }
  const hits = (b, rects) =>
    rects.some(([l, t, r, btm]) => b.x < r + MARGIN && b.x + b.w > l - MARGIN && b.top < btm + MARGIN && b.top + b.h > t - MARGIN);

  /** The cast's place for one scene: {anchor, s, x, y} or {hidden: true}. rects: the scene's text boxes [left, top, right, bottom]. */
  function placeFor(kind, rects, prev) {
    let best = null;
    for (const [anchor, max] of SPOTS[kind] ?? SPOTS.list) {
      for (let s = max; s >= MIN_SCALE - 1e-9; s = Math.round((s - 0.05) * 100) / 100) {
        const b = spotBox(anchor, s);
        if (!hits(b, rects)) {
          if (!best || s > best.s + 1e-9) best = { anchor, s, x: b.x, y: b.y };
          break;
        }
      }
    }
    if (kind === "list" && prev && !prev.hidden && prev.kind === "list") {
      const b = spotBox(prev.anchor, prev.s);
      if (!hits(b, rects) && (!best || best.s <= prev.s + 0.35)) return { anchor: prev.anchor, s: prev.s, x: b.x, y: b.y, kind };
    }
    return best ? { ...best, kind } : { hidden: true, kind };
  }

  /** Union centre of a scene's text (where the gears look), or the frame centre. */
  function targetOf(rects) {
    if (!rects.length) return [W / 2, H / 2];
    const l = Math.min(...rects.map((r) => r[0])), t = Math.min(...rects.map((r) => r[1]));
    const r = Math.max(...rects.map((q) => q[2])), b = Math.max(...rects.map((q) => q[3]));
    return [(l + r) / 2, (t + b) / 2];
  }

  // ------------------------------------------------------------------ the cast group: its place over time (pure)
  const MOVE_IN = 0.25, MOVE_OUT = 0.35; // a move runs from (scene start - 0.25 s) to (scene start + 0.35 s), as the scenes cross-fade
  /** keys: [{at, x, y, s, hidden}] one per scene (at = scene start). Returns {x, y, s}: the transform of cast space at t. */
  function groupAt(t, keys) {
    let k = 0;
    while (k + 1 < keys.length && t >= keys[k + 1].at - MOVE_IN) k++;
    const cur = keys[k], prev = k > 0 ? keys[k - 1] : null;
    const off = (p) => ({ x: p.x, y: H + 60, s: p.s }); // a hidden cast waits below the frame
    const to = cur.hidden ? off(prev && !prev.hidden ? prev : cur) : cur;
    if (!prev) return { x: to.x, y: to.y, s: to.s };
    const from = prev.hidden ? off(cur.hidden ? prev : cur) : prev;
    // appearing from hidden: jump to the new spot at once, the gears drop in from above (plan())
    if (prev.hidden && !cur.hidden) return { x: cur.x, y: cur.y, s: cur.s };
    const u = ease.inOutCubic(seg(t, cur.at - MOVE_IN, cur.at + MOVE_OUT));
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const jump = dist > 40 && !cur.hidden ? 90 * Math.sin(Math.PI * u) : 0;
    return { x: mix(from.x, to.x, u), y: mix(from.y, to.y, u) - jump, s: mix(from.s, to.s, u) };
  }

  // ------------------------------------------------------------------ the performance (pure)
  const MIN_GAP = 0.9; // seconds between two acts of one gear (a hop takes about 0.6 s plus its landing)
  const MOOD = { alert: "worried", "chart-down": "worried", lock: "worried", hourglass: "worried", check: "happy", "chart-up": "happy", people: "happy", heart: "happy", lightbulb: "shock", brain: "shock" };
  const hasDigit = (w) => /\d/.test(w);

  /**
   * plan(timeline beats, scenes, places, seed) -> { specs: {body, focus, direction} (Character.actor specs), keys (groupAt), total }
   * scenes: [{kind, start, end, beats: [beat index]}]; places: per scene {anchor, s, x, y, target: [x, y]} or {hidden: true}.
   */
  function plan(beats, scenes, places, seed = 1) {
    const ids = GEARS.map((g) => g.id);
    const moves = {}, faces = {}, looks = {}, last = {};
    for (const id of ids) { moves[id] = []; faces[id] = []; looks[id] = []; last[id] = -Infinity; }
    const act = (id, m) => {
      if (m.at - last[id] < MIN_GAP) return false;
      moves[id].push(m);
      last[id] = m.at;
      return true;
    };
    const face = (id, at, f, w) => faces[id].push(w ? { at, face: f, with: w } : { at, face: f });
    const h01 = (n, s) => M.hash01(n, seed * 31 + s);
    const lastBeat = beats[beats.length - 1], total = lastBeat.startSec + lastBeat.durSec;

    // where each gear's face is on stage in a scene, and the look that points it at the text
    const lookAt = (P, i) => {
      const c = CLUSTER.centres[i], fx = P.x + c[0] * P.s, fy = P.y + c[1] * P.s;
      const dx = P.target[0] - fx, dy = P.target[1] - fy, L = Math.hypot(dx, dy) || 1;
      return { x: f2((0.9 * dx) / L), y: f2((0.75 * dy) / L) };
    };

    let content = 0;
    scenes.forEach((sc, k) => {
      const P = places[k];
      if (P.hidden) return;
      const t0 = sc.start, prev = k > 0 ? places[k - 1] : null;
      const arrives = !prev || prev.hidden;
      const moved = prev && !prev.hidden && (Math.abs(prev.x - P.x) > 40 || Math.abs(prev.y - P.y) > 40);

      if (arrives) {
        // drop in: BODY is already falling at the scene's first frame (an act may start before 0)
        ids.forEach((id, i) => {
          const at = t0 - 0.15 + 0.15 * i;
          if (act(id, { at, do: "drop", height: 300 - 40 * i, T: 0.55, e: 0.38 })) {
            face(id, at + 0.3, "shock");
            face(id, at + 0.85, "happy");
          }
        });
      } else if (moved) {
        // the group jumps to the new spot: each gear crouches, stretches through the jump and squashes on landing
        ids.forEach((id) => act(id, { at: t0 - MOVE_IN - 0.17, do: "hop", height: 18, flight: MOVE_IN + MOVE_OUT }));
      }

      // gaze: the title and the end card look at the viewer first (one look at the viewer, then at what matters)
      ids.forEach((id, i) => {
        const L = lookAt(P, i);
        if (sc.kind === "title" || sc.kind === "cta") {
          looks[id].push({ at: t0 + 0.5, x: 0, y: 0 }, { at: t0 + 1.25 + 0.08 * i, ...L });
        } else {
          looks[id].push({ at: t0 + 0.12 + 0.05 * i, ...L });
        }
      });

      if (sc.kind === "section") {
        ids.forEach((id, i) => act(id, { at: t0 + 0.55 + 0.15 * i, do: "hop", height: 64 - 10 * i }));
        ids.forEach((id) => { face(id, t0 + 0.6, "happy"); face(id, Math.min(sc.end, t0 + 1.8), "calm"); });
      } else if (sc.kind === "list") {
        for (const bi of sc.beats) {
          const b = beats[bi], tb = b.startSec;
          if (b.type === "conclusion") {
            ids.forEach((id, i) => { act(id, { at: tb + 0.1 + 0.14 * i, do: "hop", height: 46 - 8 * i }); face(id, tb + 0.2, "happy"); });
            continue;
          }
          const who = ids[content % 3], mood = MOOD[b.icon] ?? "calm";
          content++;
          if (mood === "shock") act(who, { at: tb + 0.05, do: "take", amount: 0.7, face: "shock", after: "happy" });
          else if (mood === "worried") act(who, { at: tb + 0.05, do: "take", amount: 0.4, face: "worried", after: "calm" });
          else if (act(who, { at: tb + 0.05, do: "hop", height: 22 + 16 * h01(bi, 3) })) face(who, tb + 0.12, mood === "happy" ? "happy" : "calm");
          for (const id of ids) if (id !== who) face(id, tb + 0.15, mood === "worried" ? "worried" : "calm", mood === "worried" ? { browTilt: 0.5 } : undefined);
          // a number being read: FOCUS does a double take on it
          const num = (b.words ?? []).find((w) => hasDigit(w.w));
          if (num) act("focus", { at: num.s - 0.12, do: "take", amount: 0.8, face: "shock", after: "happy" });
        }
      } else if (sc.kind === "quote") {
        ids.forEach((id, i) => face(id, t0 + 0.2 + 0.1 * i, "calm", { lid: 0.62, smile: 0.5 })); // settled, regulated
      } else if (sc.kind === "cta") {
        act("body", { at: t0 + 0.35, do: "hop", height: 52 });
        ids.forEach((id) => face(id, t0 + 0.3, "happy"));
        ids.forEach((id) => looks[id].push({ at: Math.max(t0 + 2, sc.end - 1.5), x: 0, y: 0 }));
      }
    });

    // BODY drives; it turns while Mark speaks and eases off in the gaps between beats. FOCUS and DIRECTION mesh with it.
    const SPEED = { title: 1.5, content: 0.85, section_title: 1.2, conclusion: 1.6, hook: 0.3, cta: 1.3 };
    const spin = [[0, 0.4]];
    for (const b of beats) {
      const a = b.startSec, e = b.startSec + b.durSec, w = SPEED[b.type] ?? 0.8;
      if (b.type === "section_title") spin.push([a + 0.05, 4.2], [Math.min(e - 0.1, a + 0.8), w]);
      else spin.push([a + 0.15, w]);
      spin.push([Math.max(a + 0.2, e - 0.45), w], [e - 0.02, 0.35]);
    }
    spin.sort((p, q) => p[0] - q[0]);
    const spinKeys = spin.filter((p, i) => i === 0 || p[0] > spin[i - 1][0] + 1e-6).map(([t, w]) => [f2(t), f2(w)]);

    const specs = {};
    ids.forEach((id, i) => {
      const c = CLUSTER.centres[i], s = CLUSTER.scale[i];
      specs[id] = {
        home: [c[0], f2(c[1] + CLUSTER.ro[i])], // the root is the feet
        scale: s, seed: seed * 7 + i + 1, flip: 1, base: "calm",
        moves: moves[id], faces: faces[id].sort((p, q) => p.at - q.at), looks: looks[id].sort((p, q) => p.at - q.at),
      };
    });
    const keys = scenes.map((sc, k) => ({ at: sc.start, ...(places[k].hidden ? { hidden: true, x: 0, y: H + 60, s: 1 } : { x: places[k].x, y: places[k].y, s: places[k].s }) }));
    return { specs, spinKeys, keys, total };
  }

  /** The three actors of a plan, meshed: BODY's angle from its keys, FOCUS from BODY, DIRECTION from FOCUS. */
  function actors(p) {
    const rigs = GEARS.map(gearRig);
    const keysFn = (t) => M.spin(t, p.spinKeys, 0);
    const body = C.actor(rigs[0], { ...p.specs.body, spins: { rotor: keysFn, depth: keysFn } });
    const focusA = (t) => M.mesh(body.spinAngle("rotor", t), { drive: 24, driven: 18, axis: AX_BF });
    const focus = C.actor(rigs[1], { ...p.specs.focus, spins: { rotor: focusA, depth: focusA } });
    const dirA = (t) => M.mesh(focus.spinAngle("rotor", t), { drive: 18, driven: 14, axis: AX_FD });
    const direction = C.actor(rigs[2], { ...p.specs.direction, spins: { rotor: dirA, depth: dirA } });
    return [body, focus, direction];
  }

  // ------------------------------------------------------------------ the music bed (pure plan)
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PROGS = [
    [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], // I V vi IV
    [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]], // vi IV I V
    [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], // I vi IV V
  ];
  const KEYS = [50, 53, 48]; // D3, F3, C3
  const BPMS = [84, 88, 92];

  /** Segments of the film the music follows: each starts a new bar and the progression from its first chord. */
  function segments(beats) {
    const lastBeat = beats[beats.length - 1], total = lastBeat.startSec + lastBeat.durSec;
    const out = [];
    beats.forEach((b, i) => {
      const kind = i === 0 ? "intro" : b.type === "section_title" ? "section" : b.type === "conclusion" ? "conclusion" : b.type === "hook" ? "hook" : b.type === "cta" ? "cta" : null;
      if (!kind) return;
      if (out.length && out[out.length - 1].kind === kind && kind !== "section") return; // a second conclusion beat continues the first
      out.push({ kind, a: b.startSec });
    });
    out.forEach((s, i) => { s.b = i + 1 < out.length ? out[i + 1].a : total; });
    return { segs: out.filter((s) => s.b - s.a > 0.05), total };
  }

  /**
   * bedPlan(beats, seed, events) -> {bpm, key, total, notes}. notes: [{at, kind, ...}] for renderBed(); kind is a Stage synth voice
   * (tone, bell, kick, tick, whoosh, bloop). events: the gears' land/snap events (sound one frame after the picture).
   */
  function bedPlan(beats, seed = 1, events = []) {
    const key = KEYS[seed % 3], prog = PROGS[Math.floor(seed / 3) % 3], bpm = BPMS[Math.floor(seed / 9) % 3];
    const beat = 60 / bpm, bar = 4 * beat;
    const { segs, total } = segments(beats);
    const notes = [];
    const end = (t) => Math.min(t, total);
    const LAYERS = {
      intro: { lp: 800, bass: false, arp: 1, drums: false, bells: false },
      section: { lp: 1000, bass: true, arp: 2, drums: true, bells: false },
      conclusion: { lp: 1500, bass: true, arp: 2, drums: true, bells: true },
      hook: { lp: 650, bass: false, arp: 0, drums: false, bells: false },
      cta: { lp: 1100, bass: true, arp: 2, drums: true, bells: false },
    };
    for (const sg of segs) {
      const L = LAYERS[sg.kind];
      if (sg.kind !== "intro") {
        notes.push({ kind: "whoosh", at: sg.a, rise: Math.min(0.7, sg.a), fall: 0.35, f0: 250, f1: 2600, gain: 0.08 });
        notes.push({ kind: "bell", at: sg.a, f: f2(midiHz(key + 24)), decay: 1.6, gain: 0.07 });
      }
      for (let n = 0; sg.a + n * bar < sg.b - 0.05; n++) {
        const t = sg.a + n * bar, tEnd = end(Math.min(t + bar, sg.b)), chord = prog[n % 4];
        const last = sg.kind === "cta" && t + bar >= sg.b;
        const tones = last ? [0, 4, 7] : chord; // the end card resolves on the home chord
        for (const iv of tones) {
          notes.push({ kind: "tone", from: t, to: last ? total : Math.min(tEnd + 0.25, total), f: f2(midiHz(key + 12 + iv)), type: "sawtooth", detune: [-8, 8], attack: n === 0 ? 0.4 : 0.25, release: last ? Math.min(2.5, total - t) : 0.5, gain: 0.016, lowpass: L.lp });
        }
        const rootHz = f2(midiHz(key - 12 + (tones[0] % 12)));
        for (let q = 0; q < 4; q++) {
          const tq = t + q * beat;
          if (tq >= sg.b - 0.02) break;
          if (L.bass && (q === 0 || q === 2) && !(last && q > 0)) notes.push({ kind: "tone", from: tq, to: end(tq + beat * 1.6), f: rootHz, type: "triangle", detune: [0], attack: 0.012, release: 0.2, gain: 0.085, lowpass: 420 });
          if (L.drums && !last) {
            if (q === 0 || q === 2) notes.push({ kind: "kick", at: tq });
            notes.push({ kind: "hat", at: tq + beat / 2 });
          }
          if (L.arp) {
            const steps = L.arp === 2 ? [0, 0.5] : [0];
            steps.forEach((o, j) => {
              const ta = tq + o * beat;
              if (ta >= sg.b - 0.02 || (last && q > 0)) return;
              const deg = tones[(q * steps.length + j) % 3] + 12 * ((q + j) % 2);
              notes.push({ kind: "pluck", at: ta, f: f2(midiHz(key + 12 + deg)) });
            });
          }
          if (L.bells && q === 0) notes.push({ kind: "bell", at: tq, f: f2(midiHz(key + 24 + tones[1])), decay: 1.2, gain: 0.035 });
        }
      }
    }
    const VOICE = { body: 280, focus: 380, direction: 500 };
    for (const e of events) {
      if (e.t < 0 || e.t >= total) continue;
      if (e.kind === "land") notes.push({ kind: "bloop", at: e.t, f: VOICE[e.actor] ?? 400, gain: f2(0.07 * (e.level ?? 1)) });
      else if (e.kind === "snap") notes.push({ kind: "snap", at: e.t });
    }
    notes.sort((p, q) => (p.at ?? p.from) - (q.at ?? q.from));
    return { bpm, key, total, notes, segments: segs };
  }

  /**
   * A sustained voice (pad, bass) added straight into L/R: a naive saw or triangle per detune, a 2-pole low-pass (RBJ, Q 0.7)
   * and the same linear attack / hold / release as Stage's synth.tone(), at its pan-0 level (0.707 per channel).
   * Pure: arrays in, arrays changed; it runs in Node too.
   */
  function addTone(L, R, sr, n) {
    const i0 = Math.max(0, Math.round(n.from * sr)), i1 = Math.min(L.length, Math.round(n.to * sr));
    if (i1 <= i0) return;
    const a = Math.max(n.attack, 1 / sr), relStart = Math.max(n.from + a, n.to - n.release), lp = n.lowpass ?? 0;
    let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    if (lp > 0) {
      const w = (2 * Math.PI * Math.min(lp, sr * 0.45)) / sr, al = Math.sin(w) / (2 * 0.7), c = Math.cos(w), a0 = 1 + al;
      b0 = (1 - c) / 2 / a0; b1 = (1 - c) / a0; b2 = b0; a1 = (-2 * c) / a0; a2 = (1 - al) / a0;
    }
    const det = n.detune ?? [0], k = (n.gain * Math.SQRT1_2) / det.length;
    const inc = det.map((c) => (n.f * Math.pow(2, c / 1200)) / sr), ph = det.map(() => 0);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = i0; i < i1; i++) {
      const t = i / sr;
      let x = 0;
      for (let j = 0; j < inc.length; j++) {
        const p = ph[j];
        x += n.type === "triangle" ? 1 - 4 * Math.abs(p - 0.5) : n.type === "sine" ? Math.sin(2 * Math.PI * p) : 2 * p - 1;
        ph[j] = p + inc[j] >= 1 ? p + inc[j] - 1 : p + inc[j];
      }
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const env = t < n.from + a ? (t - n.from) / a : t < relStart ? 1 : Math.max(0, (n.to - t) / Math.max(n.to - relStart, 1 / sr));
      const v = y * env * k;
      L[i] += v;
      R[i] += v;
    }
  }

  /** A stereo AudioBuffer added into L/R so that its sample `peakIndex` lands at `at` seconds. */
  function addBuffer(L, R, sr, buf, peakIndex, at, gain) {
    const bl = buf.getChannelData(0), br = buf.numberOfChannels > 1 ? buf.getChannelData(1) : bl;
    const start = Math.round(at * sr) - peakIndex;
    const j0 = Math.max(0, -start), j1 = Math.min(bl.length, L.length - start);
    for (let j = j0; j < j1; j++) {
      L[start + j] += bl[j] * gain;
      R[start + j] += br[j] * gain;
    }
  }

  /**
   * The bed as two Float32Arrays. Sustained voices are synthesised here (addTone); the one-shots are the kit's own sound
   * designs (Stage.makeSynth: kick, tick, bell, whoosh, bloop), drawn once each into a buffer and added at their crest.
   * No Web Audio graph is rendered: 158 s of bed as ~4,000 scheduled nodes took 92 s in headless Chromium (measured
   * 2026-11-16); this way it is one pass over the samples. `synth` needs a context only as a buffer factory.
   */
  function mixBed(bp, synth, frames) {
    const sr = synth.sr, L = new Float32Array(frames), R = new Float32Array(frames);
    const cache = new Map();
    // each voice's crest is at the end of its attack in stage.js: bell and bloop 2 ms, kick 1.5 ms, tick 0.4 ms, whoosh = rise
    const shot = (key, make, peakIndex) => {
      if (!cache.has(key)) cache.set(key, { buf: make().src.buffer, peakIndex });
      return cache.get(key);
    };
    for (const n of bp.notes) {
      let s = null, gain = 1;
      if (n.kind === "tone") { addTone(L, R, sr, n); continue; }
      if (n.kind === "pluck") { s = shot(`p${n.f}`, () => synth.bell({ at: 0, f: n.f, partials: [1, 2, 3], amps: [1, 0.3, 0.1], decay: 0.45, gain: 1, maxHz: 6000 }), Math.round(0.002 * sr)); gain = 0.035; }
      else if (n.kind === "bell") { s = shot(`b${n.f}/${n.decay}`, () => synth.bell({ at: 0, f: n.f, decay: n.decay, gain: 1 }), Math.round(0.002 * sr)); gain = n.gain; }
      else if (n.kind === "kick") { s = shot("kick", () => synth.kick({ at: 0, f0: 120, f1: 48, decay: 0.2, gain: 1, click: 0.08 }), Math.round(0.0015 * sr)); gain = 0.3; }
      else if (n.kind === "hat") { s = shot("hat", () => synth.tick({ at: 0, f: 6500, decay: 0.018, gain: 1, noise: 0.85 }), Math.round(0.0004 * sr)); gain = 0.05; }
      else if (n.kind === "snap") { s = shot("snap", () => synth.tick({ at: 0, f: 1800, decay: 0.02, gain: 1, noise: 0.2 }), Math.round(0.0004 * sr)); gain = 0.06; }
      else if (n.kind === "whoosh") { const rise = Math.max(n.rise, 0.05); s = shot(`w${rise}`, () => synth.whoosh({ at: rise, rise, fall: n.fall, f0: n.f0, f1: n.f1, gain: 1 }), Math.round(rise * sr)); gain = n.gain; }
      else if (n.kind === "bloop") { s = shot(`o${n.f}`, () => synth.bloop({ at: 0, f: n.f, bend: 1.3, decay: 0.1, gain: 1 }), Math.round(0.002 * sr)); gain = n.gain; }
      if (s) addBuffer(L, R, sr, s.buf, s.peakIndex, n.at, gain);
    }
    return { L, R };
  }

  // ------------------------------------------------------------------ page layer (DOM)
  const NS = "http://www.w3.org/2000/svg";

  /** Text boxes of one scene element, in stage pixels: every non-empty text run's line boxes, plus icon tiles and the button. */
  function textRects(el) {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const b of range.getClientRects()) if (b.width > 0 && b.height > 0) out.push([b.left, b.top, b.right, b.bottom]);
    }
    for (const t of el.querySelectorAll(".beaticon, .cta__btn")) {
      const b = t.getBoundingClientRect();
      if (b.width > 0) out.push([b.left, b.top, b.right, b.bottom]);
    }
    return out;
  }

  /**
   * mount({stage, before, beats, scenes, seek, seed}): measure, plan, build the SVG. scenes: [{kind, start, end, root, beats: [index]}].
   * Returns {draw(t), report, renderBed(sampleRate), bedChunk(start, count)}.
   */
  function mount(o) {
    const warnings = [];
    const places = [];
    o.scenes.forEach((sc, k) => {
      o.seek(sc.start + Math.min(1.2, (sc.end - sc.start) / 2));
      const rects = textRects(sc.root);
      // a beat without spoken words shows the caption pill along the bottom: keep clear of it
      if (sc.beats.some((i) => !(o.beats[i].words && o.beats[i].words.length))) rects.push([160, 950, 1760, 1060]);
      const P = placeFor(sc.kind, rects, k > 0 ? places[k - 1] : null);
      if (!P.hidden) P.target = targetOf(rects);
      else warnings.push(`cast: no room in the ${sc.kind} scene at ${sc.start.toFixed(2)} s, the gears step out`);
      places.push(P);
    });
    o.seek(0);

    const p = plan(o.beats, o.scenes.map((s) => ({ kind: s.kind, start: s.start, end: s.end, beats: s.beats })), places, o.seed);
    const cast = actors(p);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("id", "cast");
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("style", "position:absolute;left:0;top:0;overflow:visible;pointer-events:none");
    o.stage.insertBefore(svg, o.before ?? null);
    const group = document.createElementNS(NS, "g");
    svg.appendChild(group);
    const views = cast.map((a) => a.mount(group));

    const events = [];
    cast.forEach((a, i) => a.events.forEach((e) => events.push({ t: e.t + 1 / 30, kind: e.kind, level: e.level, actor: GEARS[i].id })));
    const bp = bedPlan(o.beats, o.seed, events);
    let bed = null;

    return {
      draw(t) {
        const g = groupAt(t, p.keys);
        group.setAttribute("transform", `translate(${f2(g.x)} ${f2(g.y)}) scale(${Math.round(g.s * 1000) / 1000})`);
        for (const v of views) v.draw(t);
      },
      report: {
        places: places.map((P, k) => ({ kind: o.scenes[k].kind, start: o.scenes[k].start, ...(P.hidden ? { hidden: true } : { anchor: P.anchor, scale: P.s }) })),
        actors: cast.length,
        acts: Object.values(p.specs).reduce((n, s) => n + s.moves.length, 0),
        bed: { bpm: bp.bpm, key: bp.key, notes: bp.notes.length, segments: bp.segments.length },
        warnings,
      },
      async renderBed(sampleRate = 48000) {
        // the context is only a buffer factory for the kit's one-shots; it is never rendered
        const ctx = new OfflineAudioContext(2, 128, sampleRate);
        const { L, R } = mixBed(bp, S.makeSynth(ctx, ctx.createGain(), o.seed, "mix"), Math.ceil(bp.total * sampleRate));
        let peak = 0;
        for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
        bed = { L, R, gain: peak > 0 ? 0.5 / peak : 0 }; // peak at -6 dBFS; render.ts sets the level against the voice
        return { frames: L.length, sampleRate, peak };
      },
      bedChunk(start, count) {
        if (!bed) throw new Error("renderBed() first");
        const end = Math.min(start + count, bed.L.length), out = new Int16Array(Math.max(0, end - start) * 2);
        for (let i = start, j = 0; i < end; i++, j += 2) {
          out[j] = Math.round(clamp(bed.L[i] * bed.gain, -1, 1) * 32767);
          out[j + 1] = Math.round(clamp(bed.R[i] * bed.gain, -1, 1) * 32767);
        }
        const u8 = new Uint8Array(out.buffer);
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      },
    };
  }

  root.Cast = { COL, GEARS, CLUSTER, HEAD, SPOTS, gearPath, gearRig, spotBox, placeFor, targetOf, groupAt, plan, actors, segments, bedPlan, addTone, addBuffer, mixBed, mount };
})(typeof window !== "undefined" ? window : globalThis);
