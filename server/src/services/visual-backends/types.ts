// ---------------------------------------------------------------------------
// Visual generation backend interface
// ---------------------------------------------------------------------------

export interface VisualGenerationOpts {
  prompt: string;
  width?: number;
  height?: number;
  /** Duration in seconds (for video) */
  durationSec?: number;
  /** Aspect ratio hint (e.g. "9:16") */
  aspectRatio?: string;
  /** Additional model-specific options */
  extra?: Record<string, unknown>;
}

export type VisualJobStatus =
  | "queued"
  | "generating"
  | "processing"
  | "ready"
  | "failed";

export interface VisualJobResult {
  jobId: string;
  status: VisualJobStatus;
  /** Raw asset data when ready */
  assetBuffer?: Buffer;
  /** MIME type of the generated asset */
  contentType?: string;
  /** Original filename hint */
  filename?: string;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Duration in ms (video) */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
}

export type VisualCapability = "image" | "video";

export interface VisualBackend {
  /** Unique backend name */
  name: string;
  /** What this backend can produce */
  capabilities: VisualCapability[];
  /** Start an image generation job */
  generateImage(opts: VisualGenerationOpts): Promise<VisualJobResult>;
  /** Start a video generation job */
  generateVideo(opts: VisualGenerationOpts): Promise<VisualJobResult>;
  /** Check status of a pending job */
  checkJob(jobId: string): Promise<VisualJobResult>;
}
