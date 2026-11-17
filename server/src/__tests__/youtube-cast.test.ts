// ---------------------------------------------------------------------------
// The YouTube cast (animated/cast/cast.js): three gears with faces + a song under the voice, behind YT_CAST_PILLARS.
// The page layer (measure the text, mount the SVG and the 3D bodies in Chromium) needs a browser and is checked by a real
// render; everything it decides with is pure and runs here: the vendored stage.js + character.js + cast.js are loaded into
// one vm context, the same way the kit's own tests load them.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, describe, expect, it } from "vitest";

import { castFor, pickSong, renderAnimatedVideo } from "../services/youtube/animated-video.js";
import { bedMixFilter, loadTimeline, validateTimeline, type Timeline } from "../services/youtube/animated/render.js";

const CAST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "youtube", "animated", "cast");
const ctx: Record<string, any> = { console, URLSearchParams, location: { search: "" } };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["stage.js", "character.js", "cast.js", "vignettes.js"]) vm.runInContext(readFileSync(join(CAST_DIR, f), "utf8"), ctx, { filename: f });
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
    ["content", "Say it 2 more times.", "Motivation vs Systems", "clock"],
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
  it("scenes.html loads three.min.js, stage.js, character.js and cast.js from cast/, in that order, before its own script", () => {
    const html = readFileSync(join(CAST_DIR, "..", "scenes.html"), "utf8");
    const at = ["cast/three.min.js", "cast/stage.js", "cast/character.js", "cast/cast.js", "cast/vignettes.js"].map((f) => html.indexOf(`<script src="${f}"></script>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(at[4]).toBeLessThan(html.indexOf("window.seek = "));
  });
  it("the vendored three.js is 0.186.1, a classic script that sets window.THREE, with its licence kept", () => {
    const three = readFileSync(join(CAST_DIR, "three.min.js"), "utf8");
    expect(three.slice(0, 400)).toContain("three.js 0.186.1 (MIT");
    expect(three).toContain("@license");
    expect(three).not.toMatch(/^\s*(import|export)\s/m);
    expect(three).toContain("window.THREE");
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
  it("seeds from the production id: same id, same video; another id, another seed (the song is pickSong's)", () => {
    const a = castFor("motivation", "787084c8-98d9-4f77-b2e3-02c08d268ae8", "all")!;
    expect(a).toEqual(castFor("motivation", "787084c8-98d9-4f77-b2e3-02c08d268ae8", "all"));
    expect(a.seed).not.toBe(castFor("motivation", "c40ab5a4-0000-0000-0000-000000000000", "all")!.seed);
    expect(Number.isInteger(a.seed) && a.seed >= 0 && a.seed < 2 ** 31).toBe(true);
    expect(a).toEqual({ seed: a.seed });
  });
});

describe("pickSong: the song under a cast video, from YT_MUSIC_DIR/<pillar>/", () => {
  const top = mkdtempSync(join(tmpdir(), "yt-songs-test-"));
  afterAll(() => rmSync(top, { recursive: true, force: true }));
  const root = join(top, "music");
  mkdirSync(join(root, "motivation"), { recursive: true });
  mkdirSync(join(top, "outside"));
  writeFileSync(join(top, "outside", "x.m4a"), ""); // a song a "../outside" pillar would reach without the name rule
  for (const f of ["b.m4a", "a.mp3", "notes.txt", ".hidden.m4a", "c.WAV"]) writeFileSync(join(root, "motivation", f), "");
  it("picks one song file by the seed, the same seed always the same song, in name order", () => {
    const pick = async (seed: number) => (await pickSong("motivation", seed, root))?.slice(root.length + 1);
    return Promise.all([0, 1, 2, 3].map(pick)).then((got) => expect(got).toEqual(["motivation/a.mp3", "motivation/b.m4a", "motivation/c.WAV", "motivation/a.mp3"]));
  });
  it("the pillar's own folder, any case; none for an unset dir, a missing folder, or a pillar that is not a plain name", async () => {
    expect(await pickSong("MOTIVATION", 1, root)).toBe(join(root, "motivation", "b.m4a"));
    for (const [pillar, dir] of [["crypto", root], ["motivation", undefined], ["motivation", " "], ["../outside", root], [undefined, root]] as const) {
      expect(await pickSong(pillar, 0, dir)).toBeUndefined();
    }
  });
});

describe("timeline.cast", () => {
  const base = { width: 1920, height: 1080, fps: 30, audio: null, beats: [{ type: "title", text: "x", startSec: 0, durSec: 1 }] };
  it("is optional, and kept when valid; music is a song file path or absent", () => {
    expect(validateTimeline(base).cast).toBeUndefined();
    expect(validateTimeline({ ...base, cast: { seed: 7 } }).cast).toEqual({ seed: 7 });
    expect(validateTimeline({ ...base, cast: { seed: 7, music: "songs/a.m4a" } }).cast).toEqual({ seed: 7, music: "songs/a.m4a" });
  });
  it("refuses a bad seed or music value", () => {
    for (const cast of [null, 3, { seed: "7" }, { seed: -1 }, { seed: 1.5 }, { seed: 7, music: true }, { seed: 7, music: "" }, { seed: 7, music: 5 }]) {
      expect(() => validateTimeline({ ...base, cast })).toThrow(/cast/);
    }
  });
  it("a song is found next to the timeline, and a missing one fails at load, before any frame is rendered", async () => {
    const d = mkdtempSync(join(tmpdir(), "yt-song-load-"));
    try {
      writeFileSync(join(d, "song.m4a"), "");
      writeFileSync(join(d, "ok.json"), JSON.stringify({ ...base, cast: { seed: 1, music: "song.m4a" } }));
      writeFileSync(join(d, "gone.json"), JSON.stringify({ ...base, cast: { seed: 1, music: "nope.m4a" } }));
      expect((await loadTimeline(join(d, "ok.json"))).songPath).toBe(join(d, "song.m4a"));
      await expect(loadTimeline(join(d, "gone.json"))).rejects.toThrow(/no song at/);
    } finally {
      rmSync(d, { recursive: true, force: true });
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
  it("frame 0 is already moving: BODY is mid-drop at t = 0, not hanging at the top", () => {
    expect(body.pose(0).lift).toBeGreaterThan(20);
    // moving AT frame 0: it was higher a frame before (a drop released at 0 would still be at rest there)
    expect(body.pose(-1 / 30).lift - body.pose(0).lift).toBeGreaterThan(1);
    expect(body.pose(0).lift - body.pose(1 / 30).lift).toBeGreaterThan(1);
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
    const beat = BEATS.find((b) => b.text.includes("2 more times"))!;
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

describe("the 3D bodies' pure parts", () => {
  it("gearOutline: N teeth, every point between the root and tip radius, the same radii as the SVG path", () => {
    for (const N of [24, 18, 14]) {
      const o = Cast.gearOutline(N, 76.8, 3);
      expect(o.pts).toHaveLength(N * 6); // 4 tooth corners + 2 inner root-arc points per tooth
      for (const [x, y] of o.pts) {
        const r = Math.hypot(x, y);
        expect(r).toBeGreaterThanOrEqual(o.rr - 1e-9);
        expect(r).toBeLessThanOrEqual(o.ro + 1e-9);
      }
      const svg = Cast.gearPath(N, 76.8);
      expect(o.ro).toBeCloseTo(svg.ro, 9);
      expect(o.rr).toBeCloseTo(svg.rr, 9);
    }
  });
  it("faceMatrix: the face is foreshortened like the tilted hub (an orthographic view of a tilted plane)", () => {
    const m = /^matrix\(([^)]+)\)$/.exec(Cast.faceMatrix())!;
    const [a, b, c, d] = m[1].split(" ").map(Number);
    expect(a).toBeCloseTo(Math.cos(-0.45), 3); // width shrinks by cos of the turn about y
    expect(d).toBeCloseTo(Math.cos(0.35), 3); // height by cos of the lean about x
    expect(c).toBe(0);
    expect(b).toBeCloseTo(-Math.sin(0.35) * Math.sin(-0.45), 3);
  });
});

describe("explainer scenes (vignettes.js): a picture of each line's idea that the gears act out", () => {
  const VG = Cast.VIGNETTES;
  it("picks the scene from the line's words", () => {
    const cases: Array<[string, string | null]> = [
      ["Motivation is a spark that gets you started, but it always fades away.", "spark"],
      ["A system is a repeatable process that works regardless of your current mood.", "loop"],
      ["Discipline is easier when you remove the obstacles between you and the task.", "friction"],
      ["Small habits create a track record of success that builds real confidence.", "steps"],
      ["Spotting crypto scam red flags before you click.", "warning"],
      ["Unbonding takes a waiting period before you can move your coins.", "wait"],
      ["Never share your seed phrase; keep your keys offline.", "protect"],
      ["Rest is part of the work, so sleep and recover.", "rest"],
      ["Choose systems instead of willpower.", "compare"],
      ["Your peer group shapes the standards you hold.", "link"],
      ["The idea clicks once you understand the design.", "bulb"],
      ["Eventually you become the person who does the work.", "sprout"],
      ["Say it out loud.", null],
    ];
    for (const [text, kind] of cases) expect([text, VG.pick(text, null)]).toEqual([text, kind]);
  });
  it("never the same scene twice running, and no growing plant next to money words (no promise of returns)", () => {
    expect(VG.pick("Motivation fades.", "spark")).not.toBe("spark");
    expect(VG.pick("Your skills grow.", null)).toBe("sprout"); // control: the same shape of line without money words
    expect(VG.pick("Your staking rewards grow.", null)).toBeNull(); // only the sprout would match, and money words switch it off
    expect(VG.pick("Your habits grow over time.", "loop")).toBe("wait"); // "over time" is next once the loop is used
  });
  it("lands the scene's moment on its key word, read from the forced-alignment word times", () => {
    const b = { startSec: 10, durSec: 4, words: ["it", "always", "fades", "away."].map((w, i) => ({ w, s: 10.5 + i * 0.6, e: 10.9 + i * 0.6 })) };
    expect(VG.payoffTime(b, "spark")).toBeCloseTo(12.3, 9); // the last key word: "away"
    expect(VG.payoffTime({ ...b, words: [] }, "spark")).toBeCloseTo(12.2, 9); // no words: 55% in
    expect(VG.payoffTime({ startSec: 0, durSec: 4, words: [{ w: "Instead", s: 0, e: 0.3 }] }, "compare")).toBeCloseTo(0.6, 9); // never before 0.6 s in
  });
  it("every scene's acting is valid character data, and its pose stays finite through the line", () => {
    for (const kind of VG.KINDS) {
      const beats = [
        { type: "title", text: "t", startSec: 0, durSec: 3 },
        { type: "content", text: "x", title: "L", startSec: 3, durSec: 4.5, words: [] },
        { type: "cta", text: "c", startSec: 7.5, durSec: 3 },
      ];
      const scenes = [
        { kind: "title", start: 0, end: 3, beats: [0] },
        { kind: "list", start: 3, end: 7.5, beats: [1] },
        { kind: "cta", start: 7.5, end: 10.5, beats: [2] },
      ];
      const pickWas = VG.pick;
      VG.pick = () => kind; // force this scene on the line
      try {
        const places = scenes.map((sc) => ({ ...Cast.placeFor(sc.kind, [], null), target: [900, 500] }));
        const p = Cast.plan(beats, scenes, places, 3);
        expect(p.vignettes.map((v: { kind: string }) => v.kind)).toEqual([kind]);
        const actors = Cast.actors(p);
        for (let t = 0; t <= 10.5; t += 0.1) for (const a of actors) {
          const q = a.pose(t);
          for (const v of [q.x, q.y, q.sx, q.sy, q.face.lid, q.parts.rotor.rot]) expect(Number.isFinite(v)).toBe(true);
        }
      } finally {
        VG.pick = pickWas;
      }
    }
  });
  it("friction jams the gears until the rock goes, then they spin free", () => {
    const b = { type: "content", text: "Remove the obstacles first.", title: "L", startSec: 3, durSec: 4, words: [{ w: "Remove", s: 4.2, e: 4.6 }] };
    const beats = [{ type: "title", text: "t", startSec: 0, durSec: 3 }, b, { type: "cta", text: "c", startSec: 7, durSec: 3 }];
    const scenes = [{ kind: "title", start: 0, end: 3, beats: [0] }, { kind: "list", start: 3, end: 7, beats: [1] }, { kind: "cta", start: 7, end: 10, beats: [2] }];
    const p = Cast.plan(beats, scenes, scenes.map((sc) => ({ ...Cast.placeFor(sc.kind, [], null), target: [900, 500] })), 3);
    const body = Cast.actors(p)[0];
    const turn = (a: number, z: number) => Math.abs(body.spinAngle("rotor", z) - body.spinAngle("rotor", a));
    expect(p.vignettes[0]).toMatchObject({ kind: "friction", k: 4.2 });
    expect(turn(3.3, 4.2)).toBeLessThan(0.05); // jammed
    expect(turn(4.6, 5.5)).toBeGreaterThan(1.5); // free
  });
  it("a scene shows from just before its line to 0.3 s after it, fading in and out", () => {
    const v = { a: 5, e: 9 };
    expect(VG.showAt(4.9, v)).toBe(0);
    expect(VG.showAt(7, v)).toBe(1);
    expect(VG.showAt(9.15, v)).toBeCloseTo(0.5, 9);
    expect(VG.showAt(9.31, v)).toBe(0);
  });
  it("the memory of the last scene resets at a new scene: a spark line right after a section still gets its spark", () => {
    const mk = (text: string, start: number) => ({ type: "content", text, title: "L" + start, startSec: start, durSec: 4, words: [] });
    const beats = [{ type: "title", text: "t", startSec: 0, durSec: 3 }, mk("Motivation is a feeling.", 3), { type: "section_title", text: "S.", startSec: 7, durSec: 2 }, mk("Motivation is a spark that fades.", 9), { type: "cta", text: "c", startSec: 13, durSec: 3 }];
    const scenes = [{ kind: "title", start: 0, end: 3, beats: [0] }, { kind: "list", start: 3, end: 7, beats: [1] }, { kind: "section", start: 7, end: 9, beats: [2] }, { kind: "list", start: 9, end: 13, beats: [3] }, { kind: "cta", start: 13, end: 16, beats: [4] }];
    const p = Cast.plan(beats, scenes, scenes.map((sc) => ({ ...Cast.placeFor(sc.kind, [], null), target: [900, 500] })), 3);
    expect(p.vignettes.map((v: { kind: string }) => v.kind)).toEqual(["spark", "spark"]);
  });
});

describe("where the cast stands (placeFor)", () => {
  it("with no text, takes the first spot at its largest scale", () => {
    expect(Cast.placeFor("section", [], null)).toMatchObject({ anchor: "rc", s: 1.7 });
    expect(Cast.placeFor("list", [], null)).toMatchObject({ anchor: "bl", s: 1.45 });
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
      const b = Cast.spotBox(P.anchor, P.s, kind);
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
    expect(prev).toMatchObject({ anchor: "br", s: 1 });
    // next scene: bottom-left free again but only up to 1.3x (text above it), not clearly bigger than 1.0 + 0.35: stay
    expect(Cast.placeFor("list", [[0, 300, 600, 430]], prev)).toMatchObject({ anchor: "br", s: 1 });
    // a clearly bigger spot (1.45x) wins
    expect(Cast.placeFor("list", [], prev)).toMatchObject({ anchor: "bl", s: 1.45 });
  });
  it("a section card always takes its own bigger spot, even right after a list", () => {
    const prev = Cast.placeFor("list", [], null);
    // a long section title across the middle: the right-centre spot is taken, the bottom-middle is not
    const P = Cast.placeFor("section", [[160, 440, 1800, 540]], prev);
    expect(P).toMatchObject({ anchor: "bm" });
    expect(P.s).toBeGreaterThan(1);
    expect(Cast.placeFor("section", [], prev)).toMatchObject({ anchor: "rc", s: 1.7 }); // never sticks to the list's spot
  });
});

describe("no sound effects (owner, 2026-11-17: not the style for these videos)", () => {
  it("the cast makes no sound: no synthesized bed, no one-shots, nothing in the page that plays or renders audio", () => {
    for (const fn of ["bedPlan", "mixBed", "addTone", "addBuffer", "segments"]) expect(Cast[fn]).toBeUndefined();
    const page = ["cast.js", "vignettes.js"].map((f) => readFileSync(join(CAST_DIR, f), "utf8")).join("\n") +
      readFileSync(join(CAST_DIR, "..", "scenes.html"), "utf8");
    expect(page).not.toMatch(/makeSynth|AudioContext|renderCastBed|castBedChunk|whoosh|bloop/);
  });
});

describe("the song mix (ffmpeg filter)", () => {
  it("leaves the voice alone: no normalising mix, a limiter with auto-level off, the song ducked by the voice", () => {
    const f = bedMixFilter(-7.25, 158);
    expect(f).toContain("volume=-7.25dB");
    expect(f).toContain("[bed][key]sidechaincompress");
    expect(f).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(f).toContain("alimiter=limit=0.97:level=disabled");
  });
  it("fades the song in over 1.5 s and out over the video's last 4 s (half each on a very short clip)", () => {
    expect(bedMixFilter(0, 158)).toContain("afade=t=in:st=0:d=1.500,afade=t=out:st=154.000:d=4.000");
    expect(bedMixFilter(0, 4)).toContain("afade=t=in:st=0:d=1.500,afade=t=out:st=2.000:d=2.000");
  });
  const hasFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasFfmpeg)("is a filter ffmpeg runs: a 3 s voice over a longer song gives 3 s of sound", () => {
    const d = mkdtempSync(join(tmpdir(), "yt-mix-"));
    try {
      const out = join(d, "mix.wav");
      execFileSync("ffmpeg", [
        "-v", "error", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=64x36:d=3",
        "-f", "lavfi", "-i", "sine=f=220:d=3",
        "-f", "lavfi", "-i", "anoisesrc=d=10:a=0.3",
        "-filter_complex", bedMixFilter(-6, 3), "-map", "[mix]", out,
      ]);
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString();
      expect(Number(probe)).toBeCloseTo(3, 1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
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
      cast: { seed: 3, music: "/song.m4a" },
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
    expect(seen[0].cast?.music).toBe("/song.m4a"); // the retry drops the song with the gears: the plain video, as before
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
