// Coherence Daddy motion system — GSAP wrapper for affiliate-facing surfaces.
// Companion to cdDesign.ts; mirrors DESIGN.md §6 and cd-cascade-in in index.css.
//
// Conventions enforced:
//   - Animate transform + opacity ONLY. Never layout properties (width, top, ...).
//   - Entrances: 480ms on the "cd" ease with a 60ms stagger (same as <Cascade>).
//   - Respect prefers-reduced-motion: gate timelines with prefersReducedMotion()
//     and jump to the end state (tl.progress(1)) rather than skipping the state change.
//   - gsap must stay OUT of the admin bundle: import this module only from
//     affiliate routes, which are lazy-loaded in App.tsx.

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(useGSAP, CustomEase);

// The CD easing signature — cubic-bezier(0.22, 0.61, 0.36, 1) wherever motion happens.
// Registered as "cd" so consumers can write `ease: "cd"`.
export const CD_EASE = CustomEase.create("cd", "0.22,0.61,0.36,1");

// Entrance timing — matches the cd-cascade-in keyframes in index.css.
export const ENTRANCE_DURATION = 0.48;
export const ENTRANCE_STAGGER = 0.06;

// Console/debug access (drive the clock headlessly via gsap.updateRoot).
if (typeof window !== "undefined") {
  (window as unknown as { gsap?: typeof gsap }).gsap = gsap;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export { gsap, useGSAP };
