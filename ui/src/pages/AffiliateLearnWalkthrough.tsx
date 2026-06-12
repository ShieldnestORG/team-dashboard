// Walkthrough visual — a real product screenshot with an animated GSAP camera
// over it: settle-in zoom, spotlight dim with label chip, simulated cursor tap.
// Screenshots live in ui/public/affiliate-learn/screenshots/ (spec'd filenames);
// a missing file degrades to the same "[ screenshot pending ]" pattern as the
// legacy screenshot field.

import { useRef, useState } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/cdMotion";
import { CD, FONT_MONO } from "@/lib/cdDesign";
import type { Visual } from "@/content/affiliate-learn";

type WalkthroughSpec = Extract<Visual, { kind: "walkthrough" }>;

// Camera: translate the pan container so (cx%, cy%) of the image sits at stage
// center at the given scale. Element-relative percent transforms — no layout
// reads, correct at any size (including hidden tabs).
function camVars(cam: { cx: number; cy: number; scale: number }) {
  const s = cam.scale;
  const xp = Math.min(0, Math.max(100 * (1 - s), 50 - s * cam.cx));
  const yp = Math.min(0, Math.max(100 * (1 - s), 50 - s * cam.cy));
  return { xPercent: xp, yPercent: yp, scale: s };
}

export function WalkthroughVisual({ visual }: { visual: WalkthroughSpec }) {
  const scope = useRef<HTMLDivElement>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const cam = visual.camera ?? { cx: 50, cy: 50, scale: 1 };
  const aspect = visual.aspect ?? { w: 1440, h: 900 };

  useGSAP(
    () => {
      if (imgFailed || !scope.current) return;
      const q = gsap.utils.selector(scope);
      const pan = q(".wt-pan");
      const spot = q(".wt-spot");
      const tag = q(".wt-tag");
      const cursor = q(".wt-cursor");
      const ripple = q(".wt-ripple");
      const target = camVars(cam);

      if (prefersReducedMotion()) {
        gsap.set(pan, target);
        if (visual.spotlight) gsap.set(spot, { opacity: 1 });
        return;
      }

      const tl = gsap.timeline();
      // settle-in: start slightly wider than the target framing
      tl.set(pan, camVars({ ...cam, scale: Math.max(1, cam.scale * 0.94) }));
      tl.to(pan, { ...target, duration: 1.0, ease: "cd" }, 0.1);

      if (visual.spotlight) {
        tl.fromTo(
          spot,
          { opacity: 0, scale: 1.1 },
          { opacity: 1, scale: 1, duration: 0.5, ease: "cd", transformOrigin: "center" },
          0.85,
        );
      }

      if (visual.tap) {
        const t0 = 1.2;
        tl.set(cursor, { opacity: 0 }, t0 - 0.05);
        tl.to(cursor, { opacity: 1, duration: 0.2 }, t0);
        tl.to(
          cursor,
          { left: `${visual.tap.x}%`, top: `${visual.tap.y}%`, duration: 0.7, ease: "power2.inOut" },
          t0 + 0.05,
        );
        tl.to(cursor, { scale: 0.82, duration: 0.1, ease: "power2.in" }, t0 + 0.8);
        tl.to(cursor, { scale: 1, duration: 0.25, ease: "back.out(3)" }, t0 + 0.9);
        tl.set(ripple, { left: `${visual.tap.x}%`, top: `${visual.tap.y}%` }, t0 + 0.85);
        tl.fromTo(
          ripple,
          { opacity: 0.9, scale: 0.3 },
          { opacity: 0, scale: 2.4, duration: 0.7, ease: "power2.out" },
          t0 + 0.85,
        );
        if (visual.spotlight) {
          tl.to(spot, { borderColor: CD.accentPressed, duration: 0.12, yoyo: true, repeat: 1 }, t0 + 0.85);
        }
      }
      // re-run when the step (and thus the visual) changes
    },
    { scope, dependencies: [visual, imgFailed] },
  );

  if (imgFailed) {
    return (
      <div
        className="rounded-xl px-5 py-8 text-center text-sm"
        style={{ border: `1px dashed ${CD.borderStrong}`, color: CD.mutedSoft }}
      >
        [ screenshot pending — {visual.src} ]
      </div>
    );
  }

  return (
    <div ref={scope}>
      <div
        className="overflow-hidden rounded-xl"
        style={{ border: `1px solid ${CD.borderStrong}`, background: CD.surface }}
      >
        {/* browser-chrome mock */}
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5"
          style={{ borderBottom: `1px solid ${CD.border}`, background: "#141417" }}
        >
          <span className="flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <i key={i} className="h-2 w-2 rounded-full" style={{ background: CD.borderStrong }} />
            ))}
          </span>
          {visual.url && (
            <span
              className="rounded-full px-3 py-0.5 truncate"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.7rem",
                color: CD.muted,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${CD.border}`,
              }}
            >
              {visual.url}
            </span>
          )}
        </div>

        {/* stage */}
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: `${aspect.w} / ${aspect.h}`, background: "#0a0a0c" }}
        >
          <div
            className="wt-pan absolute left-0 top-0 h-full w-full will-change-transform"
            style={{ transformOrigin: "0 0" }}
          >
            <img
              src={`/affiliate-learn/screenshots/${visual.src}`}
              alt=""
              draggable={false}
              className="block h-full w-full select-none"
              onError={() => setImgFailed(true)}
            />
            {visual.spotlight && (
              <div
                className="wt-spot pointer-events-none absolute rounded-[10px] opacity-0"
                style={{
                  left: `${visual.spotlight.x}%`,
                  top: `${visual.spotlight.y}%`,
                  width: `${visual.spotlight.w}%`,
                  height: `${visual.spotlight.h}%`,
                  border: `2px solid ${CD.accent}`,
                  boxShadow: "0 0 0 4000px rgba(8,8,10,0.55)",
                }}
              >
                {visual.spotlight.label && (
                  <span
                    className="wt-tag absolute -left-0.5 bottom-full mb-2 whitespace-nowrap rounded-md px-2 py-1"
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: CD.canvas,
                      background: CD.accent,
                      transform: `scale(${1 / cam.scale})`,
                      transformOrigin: "left bottom",
                    }}
                  >
                    {visual.spotlight.label}
                  </span>
                )}
              </div>
            )}
            {visual.tap && (
              <>
                <span
                  className="wt-ripple pointer-events-none absolute h-14 w-14 rounded-full opacity-0"
                  style={{
                    border: `2px solid ${CD.accent}`,
                    transform: "translate(-50%, -50%)",
                  }}
                  aria-hidden
                />
                <span
                  className="wt-cursor pointer-events-none absolute h-[22px] w-[22px] rounded-full opacity-0"
                  style={{
                    left: `${visual.tap.x - 14}%`,
                    top: `${visual.tap.y + 12}%`,
                    border: "2px solid #fff",
                    background: "rgba(255,255,255,0.25)",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
                    transform: "translate(-50%, -50%)",
                  }}
                  aria-hidden
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
