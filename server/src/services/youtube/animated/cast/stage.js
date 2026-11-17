/* VENDORED for the YouTube cast (2026-11-16) from an internal animation kit, lib/stage.js at 9459db5. Only change: the
 * export line at the end also exposes makeSynth and wavBase64, so the scenes page can render its music bed. Keep in step
 * with the kit: copy the file again rather than editing it here. */
/* motion-lab stage runtime (classic script: <script src="/lib/stage.js"></script>, before the piece's own script).
 *
 * A piece calls Stage.define({...}) once. That sets the contract render.mjs and check.mjs read:
 *   window.__meta      {width, height, fps, duration, loop, fonts, cues}
 *   window.renderAt(t) draws the frame at t seconds. Pure: the same t always gives the same pixels.
 *   window.__ready     a Promise that settles when fonts and assets are loaded
 *   window.renderAudio(sampleRate) -> base64 float32 WAV of the whole soundtrack (if the piece has audio)
 * Opened in a browser it plays itself (space = pause, arrows = one frame, H = hide the time readout).
 * ?t=1.25 draws one still and never starts the clock. ?capture is set by the renderer.
 */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const capture = params.has("capture");
  const still = params.has("t") ? Number(params.get("t")) : null;

  // ------------------------------------------------------------------ math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const mix = (a, b, t) => a + (b - a) * t;
  /** Progress of t through [a, b], clamped to 0..1. */
  const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const smoothstep = (x) => x * x * (3 - 2 * x);

  /** CSS cubic-bezier(x1, y1, x2, y2) as a function of 0..1. */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (u) => ((ax * u + bx) * u + cx) * u;
    const sy = (u) => ((ay * u + by) * u + cy) * u;
    const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(u) - x;
        if (Math.abs(e) < 1e-7) return sy(u);
        const d = dx(u);
        if (Math.abs(d) < 1e-7) break;
        u -= e / d;
      }
      let lo = 0, hi = 1;
      u = x;
      for (let i = 0; i < 40; i++) {
        const v = sx(u);
        if (Math.abs(v - x) < 1e-7) break;
        if (x > v) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }

  const ease = {
    linear: (x) => x,
    inQuad: (x) => x * x,
    outQuad: (x) => 1 - (1 - x) * (1 - x),
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuart: (x) => 1 - Math.pow(1 - x, 4),
    inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    /** Overshoot by `s` (1.70158 = 10%). */
    outBack: (s = 1.70158) => (x) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
    inBack: (s = 1.70158) => (x) => (s + 1) * x * x * x - s * x * x,
    /** Material-style curves: standard for most moves, emphasized for hero moves. */
    standard: bezier(0.2, 0, 0, 1),
    decelerate: bezier(0, 0, 0, 1),
    accelerate: bezier(0.3, 0, 1, 1),
    emphasized: bezier(0.05, 0.7, 0.1, 1),
    bezier,
  };

  /**
   * Damped spring from 0 to 1 with zero start velocity, closed form (so any t can be drawn directly).
   * freq in Hz, damping ratio: 1 = no overshoot, 0.5 ~ 16% overshoot, 0.25 ~ 44%.
   */
  function spring(t, { freq = 2, damping = 0.5 } = {}) {
    if (t <= 0) return 0;
    const w0 = 2 * Math.PI * freq, z = damping;
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
    return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
  }

  /** Seeded generator (mulberry32): rng(seed)() -> 0..1, the same sequence every run. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Smooth noise in -1..1 that repeats exactly every `period` seconds (sums of whole-cycle sines). */
  function loopNoise(t, period, seed = 1, octaves = 3) {
    const r = rng(seed * 9973 + 17);
    let v = 0, norm = 0;
    for (let k = 0; k < octaves; k++) {
      const cycles = 1 + Math.floor(r() * 3) + k * 2;
      const amp = 1 / (k + 1);
      v += amp * Math.sin((2 * Math.PI * cycles * t) / period + r() * 2 * Math.PI);
      norm += amp;
    }
    return v / norm;
  }

  /** Wrap each character (or word) of an element in a span; returns the spans. Spaces stay plain text. */
  function splitText(el, by = "chars") {
    const text = el.textContent;
    el.textContent = "";
    const out = [];
    const parts = by === "words" ? text.split(/(\s+)/) : Array.from(text);
    for (const p of parts) {
      if (/^\s+$/.test(p)) {
        el.appendChild(document.createTextNode(p));
        continue;
      }
      const s = document.createElement("span");
      s.textContent = p;
      s.style.display = "inline-block";
      s.style.willChange = "transform, opacity";
      el.appendChild(s);
      out.push(s);
    }
    return out;
  }

  // ------------------------------------------------------------------ sound
  // Every hit is a buffer drawn sample by sample, so its loudest crest lands on an exact sample:
  // hit(...).at(peakSec) starts the buffer so that crest plays at peakSec (to the sample).
  const TAU = Math.PI * 2;

  /** stem "hits" mutes the sustained bed (tone, noiseBed) so check.mjs can time each hit in isolation. */
  function makeSynth(ctx, master, seed = 7, stem = "mix") {
    const bedMuted = stem === "hits";
    const sr = ctx.sampleRate;
    const noiseRand = rng(seed);

    function bufferOf(seconds, fill) {
      const n = Math.max(1, Math.ceil(seconds * sr));
      const b = ctx.createBuffer(2, n, sr);
      const L = b.getChannelData(0), R = b.getChannelData(1);
      fill(L, R, n);
      return b;
    }
    /** Place a buffer so that sample `peakIndex` plays at `peakSec`. */
    function place(buffer, peakIndex, peakSec, { gain = 1, pan = 0, to = master } = {}) {
      lin(gain, "hit");
      const startSample = Math.round(peakSec * sr) - peakIndex;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = gain;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(g).connect(p).connect(to);
      if (startSample >= 0) src.start(startSample / sr);
      else src.start(0, -startSample / sr);
      return { src, gain: g, pan: p };
    }
    const db = (d) => Math.pow(10, d / 20);
    // gain is LINEAR amplitude (0..4); a model passed decibels (-30 -> 30x louder, phase flipped) on 2026-10-12
    const lin = (g, who) => {
      if (!(Number.isFinite(g) && g >= 0 && g <= 4)) throw new Error(`synth.${who}: gain ${g} is not a linear amplitude 0..4 (0.3 is about -10 dB); for decibels write gain: synth.db(${g})`);
      return g;
    };
    // Attack: raised cosine over `a` samples, so the envelope crest is exactly at sample a.
    const attackEnv = (n, a) => (n >= a ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * n) / a));

    return {
      sr,
      db,
      place,
      bufferOf,
      /** Pitch-drop kick; its crest (cosine phase 0 at the end of a 1.5 ms attack) is the hit. */
      kick({ at, f0 = 150, f1 = 46, drop = 0.045, decay = 0.32, gain = 0.9, click = 0.25, pan = 0 }) {
        const a = Math.round(0.0015 * sr);
        let phase0 = 0;
        const phaseAt = (n) => {
          const t = n / sr;
          // integral of f(t) = f1 + (f0 - f1) e^(-t/drop)
          return TAU * (f1 * t + (f0 - f1) * drop * (1 - Math.exp(-t / drop)));
        };
        phase0 = phaseAt(a);
        const b = bufferOf(decay * 4, (L, R, n) => {
          for (let i = 0; i < n; i++) {
            const t = Math.max(0, i - a) / sr;
            const env = attackEnv(i, a) * Math.exp(-t / decay);
            const clk = click * Math.exp(-t / 0.004) * (i < a ? 0 : 1);
            const v = env * Math.cos(phaseAt(i) - phase0) + clk * Math.cos(TAU * 1800 * t);
            L[i] = v;
            R[i] = v;
          }
        });
        return place(b, a, at, { gain, pan });
      },
      /** Short tick (hash digits, cursor, UI) with a bright top. */
      tick({ at, f = 2600, decay = 0.012, gain = 0.35, pan = 0, noise = 0.35 }) {
        const a = Math.round(0.0004 * sr);
        const r = rng(Math.round(f) + 3);
        const b = bufferOf(decay * 6, (L, R, n) => {
          for (let i = 0; i < n; i++) {
            const t = Math.max(0, i - a) / sr;
            const env = attackEnv(i, a) * Math.exp(-t / decay);
            const v = env * ((1 - noise) * Math.cos(TAU * f * t) + noise * (r() * 2 - 1));
            L[i] = v;
            R[i] = v;
          }
        });
        return place(b, a, at, { gain, pan });
      },
      /** Bell / ting: inharmonic partials in cosine phase, all cresting together at the hit. */
      bell({ at, f = 880, partials = [1, 2.0, 2.76, 4.07, 5.4], amps = [1, 0.45, 0.35, 0.18, 0.12], decay = 1.4, gain = 0.4, pan = 0, maxHz = 8000 }) {
        const a = Math.round(0.002 * sr);
        const b = bufferOf(decay * 3.5, (L, R, n) => {
          for (let i = 0; i < n; i++) {
            const t = Math.max(0, i - a) / sr;
            let v = 0;
            for (let k = 0; k < partials.length; k++) {
              const fk = f * partials[k];
              if (fk > maxHz) continue;
              v += amps[k] * Math.exp((-t * (1 + k * 0.9)) / decay) * Math.cos(TAU * fk * t);
            }
            v *= attackEnv(i, a);
            L[i] = v;
            R[i] = v;
          }
        });
        return place(b, a, at, { gain, pan });
      },
      /** Soft round "bloop": sine with a quick upward pitch bend, cosine phase at the crest. */
      bloop({ at, f = 520, bend = 1.35, decay = 0.11, gain = 0.35, pan = 0 }) {
        const a = Math.round(0.002 * sr);
        const b = bufferOf(decay * 5, (L, R, n) => {
          let ph = 0;
          for (let i = 0; i < n; i++) {
            const t = Math.max(0, i - a) / sr;
            const fi = f * (1 + (bend - 1) * (1 - Math.exp(-t / 0.03)));
            const env = attackEnv(i, a) * Math.exp(-t / decay);
            L[i] = R[i] = env * Math.cos(ph);
            if (i >= a) ph += (TAU * fi) / sr;
          }
        });
        return place(b, a, at, { gain, pan });
      },
      /** Filtered noise sweep (whoosh). Peaks at `at`; rises over `rise`, falls over `fall`. */
      whoosh({ at, rise = 0.35, fall = 0.25, f0 = 300, f1 = 3200, q = 0.9, gain = 0.25, pan = 0, panTo = null }) {
        const n0 = Math.round(rise * sr), dur = rise + fall;
        const r = rng(Math.round(at * 1000) + 11);
        const b = bufferOf(dur, (L, R, n) => {
          // state-variable band-pass, cutoff swept with the envelope
          let low = 0, band = 0;
          for (let i = 0; i < n; i++) {
            const t = i / sr;
            const up = i <= n0;
            const env = up ? Math.pow(i / n0, 2) : Math.pow(1 - (i - n0) / (n - n0), 1.6);
            const fc = up ? f0 + (f1 - f0) * Math.pow(i / n0, 1.5) : f1 * (1 - 0.4 * ((i - n0) / (n - n0)));
            const F = 2 * Math.sin((Math.PI * Math.min(fc, sr / 6)) / sr);
            const x = r() * 2 - 1;
            low += F * band;
            const high = x - low - q * band;
            band += F * high;
            const v = env * band;
            const p = panTo === null ? 0 : (panTo - pan) * (t / dur);
            L[i] = v * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2;
            R[i] = v * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
          }
        });
        return place(b, n0, at, { gain, pan: panTo === null ? pan : 0 });
      },
      /** Sustained tone from oscillators (pads, drones, sub). Starts at `from`, ends at `to`. */
      tone({ from, to, f, type = "sine", detune = [0], attack = 0.4, release = 0.6, gain = 0.15, pan = 0, lowpass = null, out = master }) {
        lin(gain, "tone");
        if (bedMuted) return { gain: ctx.createGain(), oscs: [] };
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, from);
        g.gain.linearRampToValueAtTime(gain, from + attack);
        g.gain.setValueAtTime(gain, Math.max(from + attack, to - release));
        g.gain.linearRampToValueAtTime(0, to);
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        let head = g;
        if (lowpass) {
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = lowpass;
          lp.Q.value = 0.7;
          g.connect(lp);
          head = lp;
        }
        head.connect(p).connect(out);
        const oscs = detune.map((cents) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(g);
          o.start(from);
          o.stop(to + 0.05);
          return o;
        });
        return { gain: g, oscs };
      },
      /** White noise buffer source (for beds and textures), deterministic. */
      noiseBed({ from, to, gain = 0.02, lowpass = 1200, highpass = 80, pan = 0 }) {
        lin(gain, "noiseBed");
        if (bedMuted) return { gain: ctx.createGain(), lowpass: ctx.createBiquadFilter() };
        const b = bufferOf(to - from, (L, R, n) => {
          for (let i = 0; i < n; i++) {
            L[i] = noiseRand() * 2 - 1;
            R[i] = noiseRand() * 2 - 1;
          }
        });
        const src = ctx.createBufferSource();
        src.buffer = b;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = highpass;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = lowpass;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, from);
        g.gain.linearRampToValueAtTime(gain, from + 0.5);
        g.gain.setValueAtTime(gain, Math.max(from + 0.5, to - 0.5));
        g.gain.linearRampToValueAtTime(0, to);
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(hp).connect(lp).connect(g).connect(p).connect(master);
        src.start(from);
        return { gain: g, lowpass: lp };
      },
    };
  }

  /** Float32 stereo WAV, base64 (returned to Node by render.mjs). */
  function wavBase64(buffer) {
    const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
    const bytes = 44 + n * ch * 4;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF");
    v.setUint32(4, bytes - 8, true);
    w(8, "WAVE");
    w(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 3, true); // IEEE float
    v.setUint16(22, ch, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 4, true);
    v.setUint16(32, ch * 4, true);
    v.setUint16(34, 32, true);
    w(36, "data");
    v.setUint32(40, n * ch * 4, true);
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 4) v.setFloat32(o, data[c][i], true);
    const u8 = new Uint8Array(ab);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ------------------------------------------------------------------ define
  function define(spec) {
    const meta = {
      width: spec.width,
      height: spec.height,
      fps: spec.fps ?? 30,
      duration: spec.duration,
      loop: !!spec.loop,
      fonts: spec.fonts ?? [],
      cues: spec.cues ?? [],
      title: spec.title ?? document.title,
    };
    if (!(meta.width > 0 && meta.height > 0 && meta.duration > 0)) throw new Error("Stage.define needs width, height and duration");
    window.__meta = meta;
    document.documentElement.style.setProperty("--stage-w", meta.width + "px");
    document.documentElement.style.setProperty("--stage-h", meta.height + "px");

    const ready = (async () => {
      await document.fonts.ready;
      for (const f of meta.fonts) await document.fonts.load(`400 32px "${f}"`).catch(() => undefined);
      if (spec.setup) await spec.setup();
    })();
    window.__ready = ready;

    window.renderAt = (t) => spec.render(t);

    if (spec.audio) {
      window.renderAudio = async (sampleRate = 48000, opts = {}) => {
        const n = Math.ceil(meta.duration * sampleRate);
        const ctx = new OfflineAudioContext(2, n, sampleRate);
        // master: a plain gain, no dynamics. A DynamicsCompressorNode looks ahead ~6 ms, which delays every
        // hit (two in series put every crest 12 ms late, measured on the smoke piece 2026-10-12). Loudness and
        // the true-peak ceiling are set afterwards in render.mjs, with ffmpeg's delay-compensated limiter.
        const master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);
        const synth = makeSynth(ctx, master, spec.seed ?? 7, opts.stem ?? "mix");
        await spec.audio({ ctx, master, synth, meta });
        const buffer = await ctx.startRendering();
        return wavBase64(buffer);
      };
    }

    ready.then(() => {
      if (capture) return;
      if (still !== null && Number.isFinite(still)) {
        window.renderAt(still);
        return;
      }
      startPreview(meta);
    });
  }

  function startPreview(meta) {
    const hud = document.createElement("div");
    hud.style.cssText =
      "position:fixed;left:8px;bottom:8px;font:12px/1.2 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:4px;z-index:99999;pointer-events:none";
    document.body.appendChild(hud);
    let paused = false, t = 0, last = performance.now();
    addEventListener("keydown", (e) => {
      if (e.code === "Space") paused = !paused;
      if (e.code === "ArrowRight") { paused = true; t = Math.min(meta.duration, t + 1 / meta.fps); }
      if (e.code === "ArrowLeft") { paused = true; t = Math.max(0, t - 1 / meta.fps); }
      if (e.code === "KeyH") hud.hidden = !hud.hidden;
    });
    (function frame(now) {
      const dt = (now - last) / 1000;
      last = now;
      if (!paused) t = (t + dt) % meta.duration;
      window.renderAt(t);
      hud.textContent = `${t.toFixed(2)} s  frame ${Math.floor(t * meta.fps)}${paused ? "  (paused)" : ""}`;
      requestAnimationFrame(frame);
    })(performance.now());
  }

  /** Fit the fixed-size stage into the browser window for previews (the renderer uses the exact size). */
  function fitPreview(stage) {
    if (capture) return;
    const fit = () => {
      const m = window.__meta;
      if (!m) return;
      const s = Math.min(innerWidth / m.width, innerHeight / m.height, 1);
      stage.style.transformOrigin = "0 0";
      stage.style.transform = `translate(${(innerWidth - m.width * s) / 2}px, ${(innerHeight - m.height * s) / 2}px) scale(${s})`;
    };
    addEventListener("resize", fit);
    requestAnimationFrame(fit);
  }

  window.Stage = { define, clamp, mix, seg, smoothstep, ease, bezier, spring, rng, loopNoise, splitText, fitPreview, capture, makeSynth, wavBase64 };
})();
