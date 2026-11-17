/* Coherence Daddy cast for the animated daily video (YT_CAST_PILLARS, off by default).
 *
 * Three gears with faces, BODY (coral, 24 teeth), FOCUS (gold, 18) and DIRECTION (green, 14), drawn from the brand's
 * three-gears character sheet, meshed so they turn together. They never speak: they react to the narration (they drop in,
 * hop on a new section, take a surprise on a number, look at the line being read, settle calm on the closing thought) and
 * keep out of the text's way. They make no sound: the video's music is a song mixed in by render.ts (YT_MUSIC_DIR).
 *
 * Classic script, loaded after stage.js and character.js (both vendored beside this file).
 * Two layers:
 *   - plan (pure data, also runs in Node: server/src/__tests__/youtube-cast.test.ts): placeFor(), plan(), groupAt().
 *   - page (DOM): mount() measures where each scene's text is, mounts the SVG, draw(t).
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

  /** The same outline as gearPath() as points (the root arcs in `arcSteps` steps), for the 3D bodies. */
  function gearOutline(N, rp, arcSteps = 3) {
    const m = (2 * rp) / N, ro = rp + 0.9 * m, rr = rp - 1.2 * m, pitch = (2 * Math.PI) / N;
    const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const pts = [];
    for (let i = 0; i < N; i++) {
      const th = i * pitch;
      pts.push(P(rr, th - 0.33 * pitch), P(ro, th - 0.16 * pitch), P(ro, th + 0.16 * pitch), P(rr, th + 0.33 * pitch));
      for (let k = 1; k < arcSteps; k++) pts.push(P(rr, th + 0.33 * pitch + (0.34 * pitch * k) / arcSteps));
    }
    return { pts, m, ro, rr };
  }

  /**
   * One gear as a rig. flat = true: the whole gear is SVG (rim, depth, rivets, face plate, face). flat = false: the body is
   * drawn in 3D (bodies3d) and the SVG draws only the face on top; the parts are the same, so the performance is the same.
   */
  function gearRig(g, flat = true) {
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
        { id: "depth", at: [0, f2(-p.ro + 0.9 * p.m)], z: -1, rotor: true, shapes: flat ? [teeth, { d: p.d, fill: SHADE, stroke: SHADE, sw: teeth.sw }] : [] },
        { id: "rotor", at: [0, f2(-p.ro)], z: -1, rotor: true, shapes: flat ? [teeth, ...rivets] : [] },
        // the face plate does not turn
        { id: "plate", at: [0, f2(-p.ro)], shapes: flat ? [{ ellipse: [0, 0, f2(R + 3), f2(R + 3)], fill: RING }, { ellipse: [0, 0, f2(R), f2(R)], fill: g.col }] : [] },
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
  // headroom above the cluster (cast space): hops and the drop-in everywhere; list scenes also hold the explainer props
  // (vignettes.js) up there
  const HEADS = { list: 180 };
  const headFor = (kind) => HEADS[kind] ?? 90;

  // ------------------------------------------------------------------ where the cast stands in each scene
  // Candidate spots per scene kind, best first, each with the largest scale it may take. A spot is used only where the cast's
  // box (headroom included) touches no text of that scene (inflated by MARGIN px); the largest fitting scale wins. Between
  // two list scenes the previous spot is kept when it still fits and nothing is clearly bigger (no needless jumps); a section
  // card or the end card always takes its own, bigger spot. Nowhere fits: the cast steps off the bottom edge.
  const W = 1920, H = 1080, MARGIN = 26, MIN_SCALE = 0.6;
  const SPOTS = {
    title: [["rc", 1.25], ["br", 1.0], ["tr", 1.0]],
    section: [["rc", 1.7], ["bm", 1.5], ["br", 1.4]],
    list: [["bl", 1.45], ["br", 1.0], ["tr", 0.9]],
    quote: [["br", 1.2], ["rc", 1.2], ["tr", 1.0]],
    cta: [["rc", 1.5], ["br", 1.2]],
  };
  function spotBox(anchor, s, kind = "list") {
    const head = headFor(kind), w = CLUSTER.w * s, h = (CLUSTER.h + head) * s;
    const x = anchor === "bl" ? 48 : anchor === "bm" ? (W - w) / 2 : W - (anchor === "rc" ? 96 : 48) - w;
    const top = anchor === "tr" ? 36 : anchor === "rc" ? (H - h) / 2 : H - 28 - h;
    return { x, top, w, h, y: top + head * s }; // y: where cast-space y = 0 lands
  }
  const hits = (b, rects) =>
    rects.some(([l, t, r, btm]) => b.x < r + MARGIN && b.x + b.w > l - MARGIN && b.top < btm + MARGIN && b.top + b.h > t - MARGIN);

  /** The cast's place for one scene: {anchor, s, x, y} or {hidden: true}. rects: the scene's text boxes [left, top, right, bottom]. */
  function placeFor(kind, rects, prev) {
    let best = null;
    for (const [anchor, max] of SPOTS[kind] ?? SPOTS.list) {
      for (let s = max; s >= MIN_SCALE - 1e-9; s = Math.round((s - 0.05) * 100) / 100) {
        const b = spotBox(anchor, s, kind);
        if (!hits(b, rects)) {
          if (!best || s > best.s + 1e-9) best = { anchor, s, x: b.x, y: b.y };
          break;
        }
      }
    }
    if (kind === "list" && prev && !prev.hidden && prev.kind === "list") {
      const b = spotBox(prev.anchor, prev.s, kind);
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

    let content = 0, prevKind = null;
    const VG = root.Cast && root.Cast.VIGNETTES; // the explainer scenes (vignettes.js), when loaded
    const vignettes = [], vigByBeat = new Map();
    const H = { ids, act, face, look: (id, at, l) => looks[id].push({ at, ...l }) };
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
        prevKind = null; // "never the same scene twice running" is about neighbouring lines, not across a scene change
        for (const bi of sc.beats) {
          const b = beats[bi], tb = b.startSec;
          if (b.type === "conclusion") {
            ids.forEach((id, i) => { act(id, { at: tb + 0.1 + 0.14 * i, do: "hop", height: 46 - 8 * i }); face(id, tb + 0.2, "happy"); });
            continue;
          }
          // an explainer scene when the line names an idea the gears can act out; otherwise they just react
          const kind = VG ? VG.pick(b.text, prevKind) : null;
          if (kind) {
            const v = { kind, a: tb, e: tb + b.durSec, k: f2(VG.payoffTime(b, kind)), beat: bi };
            VG.V[kind].act(H, v);
            vignettes.push(v);
            vigByBeat.set(bi, v);
            prevKind = kind;
            content++;
            continue;
          }
          prevKind = null;
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
    beats.forEach((b, bi) => {
      const a = b.startSec, e = b.startSec + b.durSec, w = SPEED[b.type] ?? 0.8;
      const v = vigByBeat.get(bi), vs = v && VG.V[v.kind].speed;
      if (vs) {
        spin.push(...vs(v));
        return;
      }
      if (b.type === "section_title") spin.push([a + 0.05, 4.2], [Math.min(e - 0.1, a + 0.8), w]);
      else spin.push([a + 0.15, w]);
      spin.push([Math.max(a + 0.2, e - 0.45), w], [e - 0.02, 0.35]);
    });
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
    return { specs, spinKeys, keys, total, vignettes };
  }

  /** The three actors of a plan, meshed: BODY's angle from its keys, FOCUS from BODY, DIRECTION from FOCUS. */
  function actors(p, flat = true) {
    const rigs = GEARS.map((g) => gearRig(g, flat));
    const keysFn = (t) => M.spin(t, p.spinKeys, 0);
    const body = C.actor(rigs[0], { ...p.specs.body, spins: { rotor: keysFn, depth: keysFn } });
    const focusA = (t) => M.mesh(body.spinAngle("rotor", t), { drive: 24, driven: 18, axis: AX_BF });
    const focus = C.actor(rigs[1], { ...p.specs.focus, spins: { rotor: focusA, depth: focusA } });
    const dirA = (t) => M.mesh(focus.spinAngle("rotor", t), { drive: 18, driven: 14, axis: AX_FD });
    const direction = C.actor(rigs[2], { ...p.specs.direction, spins: { rotor: dirA, depth: dirA } });
    return [body, focus, direction];
  }

  // ------------------------------------------------------------------ 3D bodies (three.js; the faces stay SVG on top)
  // Each gear's body is its outline extruded with a bevel, a raised hub and eight rivets, in a cartoon (toon) material: three
  // flat bands of light, the lit face exactly the brand colour (key 2.8 + ambient 0.34 = pi, the Lambert normaliser). It is
  // tipped so the rim's thickness shows, and turns about its own axis by the kit's spin angle. The SVG face gets the same
  // tilt (faceMatrix: an orthographic view of a tilted plane is an exact 2x2 matrix), so it sits painted on the hub.
  // Pure: draw(t) sets every transform from the kit's pose(t) and renders once; nothing carries over between frames.
  const TILT = [0.35, -0.45]; // radians about x and y (three.js Euler XYZ): the top leans back, the right turns away
  const HUB_FRONT = 0.1; // the hub's front face, in front of the body's, as a share of RP
  /** SVG matrix(a b c d e f) that lays the face on the tilted hub: R = Rx(TILT[0]) Ry(TILT[1]) seen along z, y flipped. */
  function faceMatrix() {
    const [ax, by] = TILT, h = HUB_FRONT * RP;
    const n = (v) => Math.round(v * 10000) / 10000;
    return `matrix(${n(Math.cos(by))} ${n(-Math.sin(ax) * Math.sin(by))} 0 ${n(Math.cos(ax))} ${n(Math.sin(by) * h)} ${n(Math.sin(ax) * Math.cos(by) * h)})`;
  }
  function bodies3d(THREE, canvas, cast) {
    // ask for the context ourselves first: without WebGL, three.js would log console errors, and the renderer treats any
    // console error as a broken page (the whole cast would be dropped instead of drawn flat)
    const opts = { alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power", premultipliedAlpha: true };
    const context = canvas.getContext("webgl2", opts);
    if (!context) throw new Error("no WebGL2 context");
    const renderer = new THREE.WebGLRenderer({ canvas, context, ...opts });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, W, 0, -H, 1, 6000);
    camera.position.set(0, 0, 3000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.34));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(-0.45, 0.6, 1);
    scene.add(key);
    const bands = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    bands.minFilter = bands.magFilter = THREE.NearestFilter;
    bands.needsUpdate = true;
    const group = new THREE.Group();
    scene.add(group);
    const rivetMat = new THREE.MeshBasicMaterial({ color: COL.canvas, transparent: true, opacity: 0.42 });
    const nodes = GEARS.map((g, i) => {
      const o = gearOutline(g.N, RP), R = o.rr - 0.19 * RP, D = 0.2 * RP, B = 0.05 * RP;
      const shape = new THREE.Shape(o.pts.map(([x, y]) => new THREE.Vector2(x, -y)));
      const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelThickness: B, bevelSize: B * 0.8, bevelSegments: 2, curveSegments: 1 });
      bodyGeo.translate(0, 0, -(D + B)); // the front face at z = 0
      const mat = new THREE.MeshToonMaterial({ color: g.col, gradientMap: bands });
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(bodyGeo, mat));
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.16 * RP, 64), mat);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = (HUB_FRONT - 0.08) * RP; // its front face at HUB_FRONT * RP
      spin.add(hub);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + 0.2, r = (o.rr + R) / 2, s = (o.rr - R) * 0.17;
        const rivet = new THREE.Mesh(new THREE.CylinderGeometry(s, s, 1, 16), rivetMat);
        rivet.rotation.x = Math.PI / 2;
        rivet.position.set(r * Math.cos(a), -r * Math.sin(a), 0.6);
        spin.add(rivet);
      }
      const tilt = new THREE.Group();
      tilt.rotation.set(TILT[0], TILT[1], 0);
      tilt.add(spin);
      const centre = new THREE.Group();
      centre.position.set(0, o.ro, 0); // the rig's root is the feet; the gear's centre is ro above them
      centre.add(tilt);
      const rootN = new THREE.Group();
      rootN.position.z = 40 * i; // later gears in front, as the SVG draws them
      rootN.add(centre);
      group.add(rootN);
      return { rootN, spin };
    });
    return {
      draw(t, G, poses) {
        group.position.set(G.x, -G.y, 0);
        group.scale.set(G.s, G.s, G.s);
        poses.forEach((P, i) => {
          const n = nodes[i];
          n.rootN.position.x = P.x;
          n.rootN.position.y = -P.y;
          n.rootN.rotation.z = -P.rot;
          n.rootN.scale.set(P.sx * P.scale * P.flip, P.sy * P.scale, P.scale);
          n.spin.rotation.z = -cast[i].spinAngle("rotor", t);
        });
        renderer.render(scene, camera);
      },
    };
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
   * Returns {draw(t), report}.
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
    // 3D bodies when three.js and WebGL are there; otherwise the whole gear in SVG (the same performance, flat)
    let look = "flat", bodies = null, canvas = null, cast = null;
    if (o.three !== false && root.THREE) {
      try {
        cast = actors(p, false);
        canvas = document.createElement("canvas");
        canvas.setAttribute("style", `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none`);
        o.stage.insertBefore(canvas, o.before ?? null);
        bodies = bodies3d(root.THREE, canvas, cast);
        look = "3d";
      } catch (err) {
        canvas?.remove();
        cast = bodies = null;
        warnings.push(`cast: 3D bodies unavailable (${err && err.message ? err.message : err}); drawing the gears flat`);
      }
    }
    if (!cast) cast = actors(p, true);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("id", "cast");
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("style", "position:absolute;left:0;top:0;overflow:visible;pointer-events:none");
    o.stage.insertBefore(svg, o.before ?? null);
    const group = document.createElementNS(NS, "g");
    svg.appendChild(group);
    // the explainer props sit in cast space under the gears' SVG (faces) and over the 3D bodies' canvas
    const VG = root.Cast.VIGNETTES, propsG = document.createElementNS(NS, "g");
    group.appendChild(propsG);
    const props = VG ? p.vignettes.map((v) => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("data-vignette", v.kind);
      propsG.appendChild(g);
      return { v, g, st: VG.V[v.kind].build(g, v) };
    }) : [];
    const views = cast.map((a) => a.mount(group));
    const FACE_MATRIX = faceMatrix();

    return {
      draw(t) {
        const g = groupAt(t, p.keys);
        group.setAttribute("transform", `translate(${f2(g.x)} ${f2(g.y)}) scale(${Math.round(g.s * 1000) / 1000})`);
        for (const pr of props) {
          const o = VG.showAt(t, pr.v);
          pr.g.setAttribute("display", o > 0 ? "inline" : "none");
          if (o > 0) {
            pr.g.setAttribute("opacity", String(Math.round(o * 1000) / 1000));
            VG.V[pr.v.kind].draw(pr.st, t, pr.v);
          }
        }
        const poses = views.map((v) => v.draw(t));
        if (bodies) {
          for (const v of views) v.nodes.plate.setAttribute("transform", `${v.nodes.plate.getAttribute("transform")} ${FACE_MATRIX}`);
          bodies.draw(t, g, poses);
        }
      },
      report: {
        look,
        places: places.map((P, k) => ({ kind: o.scenes[k].kind, start: o.scenes[k].start, ...(P.hidden ? { hidden: true } : { anchor: P.anchor, scale: P.s }) })),
        actors: cast.length,
        vignettes: p.vignettes.map((v) => ({ kind: v.kind, beat: v.beat, at: v.a, payoff: v.k })),
        acts: Object.values(p.specs).reduce((n, s) => n + s.moves.length, 0),
        warnings,
      },
    };
  }

  root.Cast = { COL, GEARS, CLUSTER, headFor, SPOTS, gearPath, gearRig, spotBox, placeFor, targetOf, groupAt, plan, actors, gearOutline, faceMatrix, mount };
})(typeof window !== "undefined" ? window : globalThis);
