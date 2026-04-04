export interface VisualGenerationOpts {
  prompt: string;
  width?: number;
  height?: number;
  durationSec?: number;
  aspectRatio?: string;
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
  assetBuffer?: Buffer;
  contentType?: string;
  filename?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  error?: string;
}

export type VisualCapability = "image" | "video";

export interface VisualBackend {
  name: string;
  capabilities: VisualCapability[];
  generateImage(opts: VisualGenerationOpts): Promise<VisualJobResult>;
  generateVideo(opts: VisualGenerationOpts): Promise<VisualJobResult>;
  checkJob(jobId: string): Promise<VisualJobResult>;
}
