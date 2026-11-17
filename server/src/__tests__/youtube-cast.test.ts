// ---------------------------------------------------------------------------
// The YouTube cast (animated/cast/cast.js): three gears with faces + a synthesized music bed, behind YT_CAST_PILLARS.
// The page layer (measure the text, mount the SVG, render the bed in Chromium) needs a browser and is checked by a real
// render; everything it decides with is pure and runs here: the vendored stage.js + character.js + cast.js are loaded into
// one vm context, the same way the kit's own tests load them.
// ---------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, describe, expect, it } from "vitest";

import { castFor, renderAnimatedVideo } from "../services/youtube/animated-video.js";
import { bedMixFilter, validateTimeline, type Timeline } from "../services/youtube/animated/render.js";

const CAST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "youtube", "animated", "cast");
const ctx: Record<string, any> = { console, URLSearchParams, location: { search: "" } };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["stage.js", "character.js", "cast.js"]) vm.runInContext(readFileSync(join(CAST_DIR, f), "utf8"), ctx, { filename: f });
const { Cast, Character } = ctx;
const M = Character.motion;

// ---- a small daily video: title, three intro lines, two sections of three lines, conclusion, quote, end card ----
type B = { type: string; text: string; startSec: number; durSec: number; title?: string; icon?: string; words?: { w: string; s: number; e: number }[] };
function timeline(): B[] {
  const spec: Array<[string, string, string?, string?]> = [
    ["title", "Why systems beat motivation", "Why Systems Beat Motivation"],
    ["content", "This is Coherence Daddy.", "In this video"],
    ["content", "Motivation is a feeling.", "In this video", "brain"],
    ["content", "Systems are design.", "In this video"],
    ["section_title", "Motivation vs Systems.", "Motivation vs Systems"],
    ["content", "A spark fades.", "Motivation vs Systems", "alert"],
    ["content", "Show up for 2 minutes.", "Motivation vs Systems", "clock"],
    ["content", "Schedule actions.", "Motivation vs Systems", "check"],
    ["section_title", "Small wins.", "Small wins"],
    ["content", "Small habits build confidence.", "Small wins", "lightbulb"],
    ["content", "Appear at the starting line.", "Small wins"],
    ["content", "The hard part is done.", "Small wins", "chart-up"],
    ["conclusion", "Stop waiting for the mood.", undefined],
    ["hook", "Discipline is a set of habits.", undefined],
    ["cta", "Subscribe for more.", undefined],
  ];
  let t = 0;
  return spec.map(([type, text, title, icon]) => {
    const durSec = type === "section_title" ? 1.8 : type === "cta" ? 6 : 4;
    const words = text.split(" ").map((w, i, a) => ({ w, s: t + 0.1 + (i * (durSec - 0.8)) / a.length, e: t + 0.1 + ((i + 0.9) * (durSec - 0.8)) / a.length }));
    const b: B = { type, text, startSec: t, durSec, words, ...(title ? { title } : {}), ...(icon ? { icon } : {}) };
    t += durSec;
    return b;
  });
}
/** The page's grouping (scenes.html group()): list beats with the same title form one scene. */
function scenesOf(beats: B[]) {
  const KIND: Record<string, string> = { title: "title", section_title: "section", content: "list", conclusion: "list", hook: "quote", cta: "cta" };
  const out: { kind: string; start: number; end: number; beats: number[] }[] = [];
  beats.forEach((b, i) => {
    const kind = KIND[b.type];
    const prev = out[out.length - 1];
    if (kind === "list" && prev?.kind === "list" && beats[prev.beats[0]].type === b.type && (beats[prev.beats[0]].title ?? "") === (b.title ?? "")) prev.beats.push(i);
    else out.push({ kind, start: b.startSec, end: 0, beats: [i] });
  });
  out.forEach((s) => { const l = beats[s.beats[s.beats.length - 1]]; s.end = l.startSec + l.durSec; });
  return out;
}
const BEATS = timeline();
const SCENES = scenesOf(BEATS);
const TOTAL = BEATS[BEATS.length - 1].startSec + BEATS[BEATS.length - 1].durSec;
// places as the page would choose them with no text in the way; scene 3 (the first section's lines) has no room
const placesFor = (hiddenScene = 3) =>
  SCENES.map((sc, k) => {
    if (k === hiddenScene) return { hidden: true };
    const P = Cast.placeFor(sc.kind, [], null);
    return { ...P, target: [700, 400] };
  });

describe("shipping the cast", () => {
  it("the server build copies the cast scripts next to scenes.html in dist (tsc does not copy .js files)", () => {
    const pkg = JSON.parse(readFileSync(join(CAST_DIR, "..", "..", "..", "..", "..", "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("cp src/services/youtube/animated/cast/*.js dist/services/youtube/animated/cast/");
  });
  it("scenes.html loads stage.js, character.js and cast.js from cast/, in that order, before its own script", () => {
    const html = readFileSync(join(CAST_DIR, "..", "scenes.html"), "utf8");
    const at = ["cast/stage.js", "cast/character.js", "cast/cast.js"].map((f) => html.indexOf(`<script src="${f}"></script>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(at[2]).toBeLessThan(html.indexOf("window.seek = "));
  });
});

describe("YT_CAST_PILLARS: the switch", () => {
  it("is off when unset or empty: no cast for any pillar", () => {
    for (const raw of [undefined, "", " , "]) {
      for (const pillar of ["motivation", "crypto", "tx_blockchain"]) expect(castFor(pillar, "prod-1", raw)).toBeUndefined();
    }
  });
  it("names pillars (comma-separated, any case) or all", () => {
    expect(castFor("motivation", "p", "motivation")).toBeDefined();
    expect(castFor("crypto", "p", "motivation")).toBeUndefined();
    expect(castFor("tx_blockchain", "p", "Motivation, TX_BLOCKCHAIN")).toBeDefined();
    expect(castFor("crypto", "p", "all")).toBeDefined();
    expect(castFor(undefined, "p", "motivation")).toBeUndefined();
  });
  it("seeds from the production id: same id, same video; another id, another seed; music on", () => {
    const a = castFor("motivation", "787084c8-98d9-4f77-b2e3-02c08d268ae8", "all")!;
    expect(a).toEqual(castFor("motivation", "787084c8-98d9-4f77-b2e3-02c08d268ae8", "all"));
    expect(a.seed).not.toBe(castFor("motivation", "c40ab5a4-0000-0000-0000-000000000000", "all")!.seed);
    expect(Number.isInteger(a.seed) && a.seed >= 0 && a.seed < 2 ** 31).toBe(true);
    expect(a.music).toBe(true);
  });
});

describe("timeline.cast", () => {
  const base = { width: 1920, height: 1080, fps: 30, audio: null, beats: [{ type: "title", text: "x", startSec: 0, durSec: 1 }] };
  it("is optional, and kept when valid", () => {
    expect(validateTimeline(base).cast).toBeUndefined();
    expect(validateTimeline({ ...base, cast: { seed: 7, music: true } }).cast).toEqual({ seed: 7, music: true });
  });
  it("refuses a bad seed or music flag", () => {
    for (const cast of [null, 3, { seed: "7", music: true }, { seed: -1, music: true }, { seed: 1.5, music: true }, { seed: 7 }, { seed: 7, music: "yes" }]) {
      expect(() => validateTimeline({ ...base, cast })).toThrow(/cast/);
    }
  });
});

describe("the gears' performance (plan)", () => {
  const plan = Cast.plan(BEATS, SCENES, placesFor(), 5);
  const actors = Cast.actors(plan);
  const [body, focus, direction] = actors;

  // every third frame (10 per second): a pose costs about 0.9 ms here, and the whole run must stay quick on a loaded machine
  it("builds three valid actors whose poses are finite all the way through", { timeout: 30_000 }, () => {
    expect(actors).toHaveLength(3);
    for (let i = 0; i <= TOTAL * 30; i += 3) {
      for (const a of actors) {
        const p = a.pose(i / 30);
        for (const v of [p.x, p.y, p.rot, p.sx, p.sy, p.face.lid, p.face.gx, p.face.gy, p.parts.rotor.rot]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
  it("frame 0 is already moving: BODY is mid-drop at t = 0", () => {
    expect(body.pose(0).lift).toBeGreaterThan(20);
    expect(body.pose(0).lift).not.toBeCloseTo(body.pose(1 / 30).lift, 3);
  });
  it("never starts two acts of one gear within 0.9 s", () => {
    for (const id of ["body", "focus", "direction"]) {
      const at = plan.specs[id].moves.map((m: { at: number }) => m.at).sort((a: number, b: number) => a - b);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(0.9 - 1e-9);
    }
  });
  it("a section card makes all three hop", () => {
    const sec = SCENES.find((s) => s.kind === "section")!;
    for (const id of ["body", "focus", "direction"]) {
      expect(plan.specs[id].moves.some((m: { do: string; at: number }) => m.do === "hop" && m.at > sec.start && m.at < sec.end)).toBe(true);
    }
  });
  it("a number being read gets FOCUS's double take just before the word", () => {
    const beat = BEATS.find((b) => b.text.includes("2 minutes"))!;
    const word = beat.words!.find((w) => w.w === "2")!;
    const shown = Cast.plan(BEATS, SCENES, placesFor(-1), 5); // that line's scene is the one placesFor() hides by default
    expect(plan.specs.focus.moves.some((m: { at: number }) => m.at > beat.startSec && m.at < beat.startSec + beat.durSec)).toBe(false);
    const take = shown.specs.focus.moves.find((m: { do: string; at: number }) => m.do === "take" && Math.abs(m.at - (word.s - 0.12)) < 1e-9);
    expect(take).toBeDefined();
  });
  it("the gears mesh: FOCUS turns against BODY, DIRECTION with BODY", () => {
    const t0 = 6, t1 = 8; // an intro line: BODY is turning
    const d = (a: { spinAngle: (p: string, t: number) => number }) => a.spinAngle("rotor", t1) - a.spinAngle("rotor", t0);
    expect(d(body)).toBeGreaterThan(0.5);
    expect(Math.sign(d(focus))).toBe(-1);
    expect(Math.sign(d(direction))).toBe(1);
    // the mesh law itself: FOCUS's angle is BODY's through mesh() at every frame
    for (const t of [0, 3.3, 17.2, TOTAL - 0.1]) {
      expect(focus.spinAngle("rotor", t)).toBeCloseTo(M.mesh(body.spinAngle("rotor", t), { drive: 24, driven: 18, axis: 0.32 }), 9);
    }
  });
  it("a scene with no room: the cast waits below the frame, then comes back", () => {
    const hid = SCENES[3], next = SCENES[4];
    expect(Cast.groupAt(hid.start + 0.5, plan.keys).y).toBeGreaterThanOrEqual(1080);
    expect(Cast.groupAt(next.start + 0.5, plan.keys).y).toBeLessThan(1080);
    // and the gears drop in again when it comes back
    expect(plan.specs.body.moves.some((m: { do: string; at: number }) => m.do === "drop" && Math.abs(m.at - (next.start - 0.15)) < 1e-9)).toBe(true);
  });
  it("is a pure function of the seed", () => {
    expect(JSON.parse(JSON.stringify(Cast.plan(BEATS, SCENES, placesFor(), 5)))).toEqual(JSON.parse(JSON.stringify(plan)));
    const other = Cast.plan(BEATS, SCENES, placesFor(), 6);
    expect(JSON.stringify(other.specs)).not.toBe(JSON.stringify(plan.specs));
  });
});

describe("where the cast stands (placeFor)", () => {
  it("with no text, takes the first spot at its largest scale", () => {
    expect(Cast.placeFor("section", [], null)).toMatchObject({ anchor: "rc", s: 1.7 });
    expect(Cast.placeFor("list", [], null)).toMatchObject({ anchor: "bl", s: 1.25 });
  });
  it("never overlaps text: 400 random layouts, every chosen box is clear of every text box by the margin", () => {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    let hidden = 0;
    for (let n = 0; n < 400; n++) {
      const rects = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => {
        const x = rnd() * 1800, y = rnd() * 1000;
        return [x, y, x + 60 + rnd() * 900, y + 40 + rnd() * 300];
      });
      const kind = ["title", "section", "list", "quote", "cta"][n % 5];
      const P = Cast.placeFor(kind, rects, null);
      if (P.hidden) { hidden++; continue; }
      const b = Cast.spotBox(P.anchor, P.s);
      expect(b.x >= 0 && b.top >= 0 && b.x + b.w <= 1920 && b.top + b.h <= 1080).toBe(true);
      for (const [l, t, r, bt] of rects) {
        const clear = b.x >= r + 26 || b.x + b.w <= l - 26 || b.top >= bt + 26 || b.top + b.h <= t - 26;
        expect(clear).toBe(true);
      }
    }
    expect(hidden).toBeLessThan(400); // the search is not trivially "always hide"
  });
  it("text across the whole bottom-left: moves to another spot or steps out", () => {
    const P = Cast.placeFor("list", [[0, 500, 1000, 1080]], null);
    expect(P.hidden || P.anchor !== "bl").toBe(true);
  });
  it("between list scenes keeps its spot when that still fits and nothing is clearly bigger (no needless jumps)", () => {
    const prev = Cast.placeFor("list", [[0, 600, 700, 1080]], null); // bottom-left taken: br
    expect(prev).toMatchObject({ anchor: "br" });
    expect(Cast.placeFor("list", [], prev)).toMatchObject({ anchor: "br", s: prev.s });
  });
  it("a section card always takes its own bigger spot, even right after a list", () => {
    const prev = Cast.placeFor("list", [], null);
    // a long section title across the middle: the right-centre spot is taken, the bottom-middle is not
    const P = Cast.placeFor("section", [[160, 440, 1800, 540]], prev);
    expect(P).toMatchObject({ anchor: "bm" });
    expect(P.s).toBeGreaterThan(prev.s);
  });
});

describe("the music bed (bedPlan)", () => {
  const bed = Cast.bedPlan(BEATS, 5, []);
  const segs = bed.segments as { kind: string; a: number; b: number }[];
  const notesIn = (a: number, b: number, kind?: string) =>
    bed.notes.filter((n: { at?: number; from?: number; kind: string }) => (n.at ?? n.from)! >= a - 1e-9 && (n.at ?? n.from)! < b - 1e-9 && (!kind || n.kind === kind));

  it("follows the film: intro, a segment per section, conclusion, quote, end card", () => {
    expect(segs.map((s) => s.kind)).toEqual(["intro", "section", "section", "conclusion", "hook", "cta"]);
  });
  it("restarts its bar on every section: a kick, a whoosh and a bell land exactly on each section's first frame", () => {
    for (const s of segs.filter((x) => x.kind === "section")) {
      for (const kind of ["kick", "whoosh", "bell"]) expect(notesIn(s.a, s.a + 1e-6, kind).length).toBe(1);
    }
  });
  it("drops the drums and the plucks under the quote, and plays nothing past the end", () => {
    const hook = segs.find((s) => s.kind === "hook")!;
    for (const kind of ["kick", "hat", "pluck"]) expect(notesIn(hook.a, hook.b, kind)).toHaveLength(0);
    for (const n of bed.notes) {
      expect((n.at ?? n.from) < TOTAL).toBe(true);
      if (n.to !== undefined) expect(n.to).toBeLessThanOrEqual(TOTAL + 1e-9);
    }
  });
  it("resolves on the home chord held to the end", () => {
    const cta = segs.find((s) => s.kind === "cta")!;
    const finals = bed.notes.filter((n: { kind: string; to?: number; from?: number; type?: string }) => n.kind === "tone" && n.type === "sawtooth" && n.to === TOTAL && n.from! >= cta.a);
    const rootHz = 440 * Math.pow(2, (bed.key + 12 - 69) / 12);
    expect(finals.map((n: { f: number }) => n.f).sort((a: number, b: number) => a - b)[0]).toBeCloseTo(rootHz, 1);
    expect(finals).toHaveLength(3);
  });
  it("is the same for the same seed, and the seed picks the key, the chords and the tempo", () => {
    expect(JSON.stringify(Cast.bedPlan(BEATS, 5, []))).toBe(JSON.stringify(bed));
    const keys = new Set([0, 1, 2].map((s) => Cast.bedPlan(BEATS, s, []).key));
    const tempi = new Set([0, 9, 18].map((s) => Cast.bedPlan(BEATS, s, []).bpm));
    expect(keys.size).toBe(3);
    expect(tempi.size).toBe(3);
  });
  it("puts a soft thud under each gear landing, inside the film only", () => {
    const withEvents = Cast.bedPlan(BEATS, 5, [
      { t: -0.1, kind: "land", actor: "body", level: 1 },
      { t: 2, kind: "land", actor: "focus", level: 0.38 },
      { t: TOTAL + 1, kind: "land", actor: "body", level: 1 },
    ]);
    const bloops = withEvents.notes.filter((n: { kind: string }) => n.kind === "bloop");
    expect(bloops).toHaveLength(1);
    expect(bloops[0]).toMatchObject({ at: 2, f: 380 });
  });
});

describe("the bed's sustained voices (addTone: pads and bass, synthesised in one pass)", () => {
  const sr = 8000;
  const tone = (o: Record<string, unknown> = {}) => {
    const L = new Float32Array(sr * 3), R = new Float32Array(sr * 3);
    Cast.addTone(L, R, sr, { from: 1, to: 2, f: 220, type: "sawtooth", detune: [-8, 8], attack: 0.2, release: 0.3, gain: 0.1, lowpass: 1000, ...o });
    return { L, R };
  };
  const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.slice(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
  it("sounds only between from and to, rises over the attack and falls over the release", () => {
    const { L, R } = tone();
    expect(rms(L, 0, 0.999)).toBe(0);
    expect(rms(L, 2.001, 3)).toBe(0);
    expect(rms(L, 1.0, 1.1)).toBeLessThan(rms(L, 1.3, 1.6) * 0.75); // still rising
    expect(rms(L, 1.9, 2.0)).toBeLessThan(rms(L, 1.3, 1.6) * 0.5); // falling
    expect(Array.from(L)).toEqual(Array.from(R)); // centred, like synth.tone() at pan 0
  });
  it("the low-pass takes the edge off: the same saw is quieter with a lower cut-off", () => {
    expect(rms(tone({ lowpass: 300 }).L, 1.3, 1.6)).toBeLessThan(rms(tone({ lowpass: 2500 }).L, 1.3, 1.6) * 0.8);
  });
  it("adds to what is already there and never writes outside the arrays", () => {
    const L = new Float32Array(sr), R = new Float32Array(sr).fill(0.25);
    Cast.addTone(L, R, sr, { from: 0.5, to: 5, f: 110, type: "triangle", detune: [0], attack: 0.01, release: 0.2, gain: 0.1, lowpass: 400 });
    expect(L.length).toBe(sr);
    expect(R[0]).toBe(0.25);
    expect(R[sr - 1]).not.toBe(0.25);
  });
});

describe("the bed mix (ffmpeg filter)", () => {
  it("leaves the voice alone: no normalising mix, a limiter with auto-level off, the bed ducked by the voice", () => {
    const f = bedMixFilter(-7.25);
    expect(f).toContain("volume=-7.25dB");
    expect(f).toContain("[bed][key]sidechaincompress");
    expect(f).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(f).toContain("alimiter=limit=0.97:level=disabled");
  });
});

describe("renderAnimatedVideo with a cast", () => {
  const dir = mkdtempSync(join(tmpdir(), "yt-cast-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const beats = [
    { type: "title", text: "Hello there", req: { title: "Hello" } },
    { type: "cta", text: "Subscribe now", req: { title: "Subscribe" } },
  ] as never;
  const aligner = async (_a: string, input: { text: string; startSec: number }[]) => ({
    words: input.map((b) => b.text.split(" ").map((w, i) => ({ w, s: b.startSec + i * 0.3, e: b.startSec + i * 0.3 + 0.25 }))),
    aligned: input.length,
    estimated: 0,
  });

  it("a failed cast render is rendered again without the cast, from the same words (no new alignment)", async () => {
    const seen: Timeline[] = [];
    let alignCalls = 0;
    const r = await renderAnimatedVideo({
      productionId: "p1", beats, slideDurations: [2, 3], speechDurations: [1.4, 3], audioPath: "/a.wav", outDir: dir,
      cast: { seed: 3, music: true },
      aligner: async (a, b) => (alignCalls++, aligner(a, b as never)),
      render: async (o) => {
        const tl = JSON.parse(readFileSync(o.timelinePath, "utf8")) as Timeline;
        seen.push(tl);
        if (tl.cast) throw new Error("cast exploded");
        writeFileSync(o.outPath, "mp4");
        return { outPath: o.outPath, frames: 150, clipSec: 5, loopSec: 1, framesPerSec: 150, wallSec: 1, hasAudio: true, scenes: 2, animations: 1, warnings: [], cast: null, music: null };
      },
    });
    expect(seen.map((t) => !!t.cast)).toEqual([true, false]);
    expect(seen[0].beats[0].words).toEqual(seen[1].beats[0].words);
    expect(alignCalls).toBe(1);
    expect(r).toMatchObject({ castUsed: false, castError: "cast exploded", cast: null, music: null });
    // the timeline left on disk is the one the video was made from
    expect(JSON.parse(readFileSync(join(dir, "timeline_p1.json"), "utf8")).cast).toBeUndefined();
  });

  it("no cast asked: one render, no cast in the timeline", async () => {
    const seen: Timeline[] = [];
    const r = await renderAnimatedVideo({
      productionId: "p2", beats, slideDurations: [2, 3], speechDurations: [1.4, 3], audioPath: "/a.wav", outDir: dir,
      aligner: aligner as never,
      render: async (o) => {
        seen.push(JSON.parse(readFileSync(o.timelinePath, "utf8")));
        writeFileSync(o.outPath, "mp4");
        return { outPath: o.outPath, frames: 150, clipSec: 5, loopSec: 1, framesPerSec: 150, wallSec: 1, hasAudio: true, scenes: 2, animations: 1, warnings: [], cast: null, music: null };
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].cast).toBeUndefined();
    expect(r.castUsed).toBe(false);
  });
});
