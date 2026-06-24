/**
 * URL → Product-Ad pipeline — shared contract.
 *
 * Each pipeline stage is implemented in its own module and communicates only
 * through these types, so stages can be built and tested independently:
 *
 *   ingest.ts            URL            -> ProductSnapshot
 *   creative-director.ts ProductSnapshot-> CreativeBrief
 *   scene-planner.ts     CreativeBrief  -> ShotList
 *   (asset gen)          Shot           -> AdAsset
 *   ad-compositor.ts     AdAsset[]      -> mp4
 */

/** Raw material scraped from a product/app URL. */
export interface ProductSnapshot {
  url: string;
  fetchedAt: string; // ISO 8601
  title: string;
  description: string;
  /** Headline + body copy strings, in document order. */
  copy: string[];
  priceText?: string;
  /** Absolute product image URLs, best/most-representative first. */
  productImageUrls: string[];
  ogImageUrl?: string;
  faviconUrl?: string;
  /** Dominant brand colors as hex (#RRGGBB), most-dominant first. */
  brandColors: string[];
  category?: string;
  reviews?: { rating?: number; count?: number; quotes?: string[] };
  /** Anything else the scraper found worth keeping. */
  raw: Record<string, unknown>;
}

/** A scene proposed by the creative director. */
export interface BriefScene {
  index: number;
  /** "hook" | "problem" | "value" | "proof" | "cta" | free text. */
  purpose: string;
  /** What to show on screen. */
  visualIdea: string;
  /** Narration line for this scene. */
  voiceover: string;
  onScreenText?: string;
}

/** Creative brief — the structured plan a human creative director would write. */
export interface CreativeBrief {
  productName: string;
  oneLiner: string;
  targetAudience: string;
  painPoint: string;
  /** The first ~3 seconds. */
  hook: string;
  /** 3-4 value propositions. */
  valueProps: string[];
  callToAction: string;
  /** e.g. "energetic, premium, confident". */
  tone: string;
  /** Visual style description (lighting, composition, mood). */
  aesthetic: string;
  /** Hex brand colors carried from the snapshot/refined. */
  brandColors: string[];
  /** 3-5 proposed scenes. */
  scenes: BriefScene[];
}

export type ShotKind = "product" | "broll" | "text_card" | "cta";
export type Transition = "cut" | "fade" | "slide" | "zoom";

/** A single shot in the final cut. */
export interface Shot {
  index: number;
  kind: ShotKind;
  /** Typically 1.5-4s. */
  durationSec: number;
  /** Back-reference to the BriefScene this shot serves. */
  sourceSceneIndex: number;
  /** Prompt for the image/video model. */
  visualPrompt: string;
  /** For product shots: URL of the scraped product image to condition on. */
  productImageRef?: string;
  voiceover?: string;
  onScreenText?: string;
  transitionOut: Transition;
}

/** Ordered shot list — the scene plan handed to asset gen + compositor. */
export interface ShotList {
  productionId: string;
  totalDurationSec: number;
  /** Music mood/genre hint for selection or generation. */
  musicMood: string;
  shots: Shot[];
}

/** A generated asset for one shot, stored via the StorageService. */
export interface AdAsset {
  shotIndex: number;
  kind: ShotKind;
  /** Backend that produced it: "grok" | "gemini" | "fal" | ... */
  backend: string;
  /** Storage object key. */
  objectKey: string;
  contentType: string;
  width: number;
  height: number;
  durationMs?: number;
  status: "pending" | "ready" | "failed";
  costCents?: number;
}
