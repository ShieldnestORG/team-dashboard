import { describe, expect, it } from "vitest";
import { statusBadge } from "../../lib/status-colors";
import { YOUTUBE_STATUS, youtubeStatusLabel } from "./youtube-status";

// Every queue status the server can send (packages/db/src/schema/youtube_pipeline.ts
// yt_publish_queue.status) must have a plain label and a StatusBadge colour key.
const QUEUE_STATUSES = [
  "pending_review",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "paused",
];

describe("youtube-status — one label and one colour for every queue status", () => {
  for (const status of QUEUE_STATUSES) {
    it(`"${status}" has a label and a StatusBadge colour key`, () => {
      const entry = YOUTUBE_STATUS[status];
      expect(entry).toBeDefined();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(statusBadge[entry.kind]).toBeDefined();
    });

    it(`the label for "${status}" is not the raw status string`, () => {
      expect(youtubeStatusLabel(status)).not.toBe(status);
    });
  }
});
