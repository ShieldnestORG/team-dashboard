import { EventEmitter } from "node:events";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamRule {
  id: string;
  value: string;
  tag?: string;
}

export interface StreamTweet {
  data: {
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics?: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      impression_count: number;
    };
  };
  includes?: {
    users?: Array<{
      id: string;
      username: string;
      name: string;
    }>;
  };
  matching_rules?: Array<{ id: string; tag: string }>;
}

// ---------------------------------------------------------------------------
// FilteredStreamClient — X API v2 filtered stream
// ---------------------------------------------------------------------------

export class FilteredStreamClient extends EventEmitter {
  private bearerToken: string;
  private abortController: AbortController | null = null;
  private connected = false;
  private connectedAt: number | null = null;
  private lastHeartbeat: Date | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxBackoffMs = 5 * 60 * 1000; // 5 minutes

  constructor(bearerToken: string) {
    super();
    this.bearerToken = bearerToken;
  }

  // ── Rule CRUD ─────────────────────────────────────────────────────────

  async getRules(): Promise<StreamRule[]> {
    const res = await fetch("https://api.x.com/2/tweets/search/stream/rules", {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "Failed to get stream rules");
      throw new Error(`GET stream rules failed: ${res.status}`);
    }

    const json = (await res.json()) as { data?: StreamRule[] };
    return json.data ?? [];
  }

  async addRules(rules: Array<{ value: string; tag: string }>): Promise<void> {
    if (rules.length === 0) return;

    const res = await fetch("https://api.x.com/2/tweets/search/stream/rules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ add: rules }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "Failed to add stream rules");
      throw new Error(`POST add stream rules failed: ${res.status}`);
    }

    const json = (await res.json()) as { meta?: { summary?: { created: number } } };
    logger.info({ created: json.meta?.summary?.created }, "Stream rules added");
  }

  async deleteRules(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const res = await fetch("https://api.x.com/2/tweets/search/stream/rules", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ delete: { ids } }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "Failed to delete stream rules");
      throw new Error(`POST delete stream rules failed: ${res.status}`);
    }

    logger.info({ deleted: ids.length }, "Stream rules deleted");
  }

  // ── Stream connection ─────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn("FilteredStreamClient already connected");
      return;
    }

    this.abortController = new AbortController();

    const url =
      "https://api.x.com/2/tweets/search/stream?" +
      "tweet.fields=public_metrics,created_at,author_id&" +
      "expansions=author_id&" +
      "user.fields=username,name";

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        logger.error({ status: res.status, body }, "Filtered stream connect failed");
        throw new Error(`Stream connect failed: ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Stream response has no body");
      }

      this.connected = true;
      this.connectedAt = Date.now();
      this.lastHeartbeat = new Date();
      this.reconnectAttempts = 0;
      this.startHeartbeatMonitor();

      logger.info("Filtered stream connected");
      this.emit("reconnect");

      // Read newline-delimited JSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\r\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim() === "") {
              // Heartbeat
              this.lastHeartbeat = new Date();
              this.emit("heartbeat");
              continue;
            }

            try {
              const parsed = JSON.parse(line) as StreamTweet;
              this.lastHeartbeat = new Date();
              this.emit("tweet", parsed);
            } catch {
              logger.warn({ line: line.substring(0, 200) }, "Failed to parse stream line");
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          logger.info("Filtered stream aborted (graceful disconnect)");
          return;
        }
        throw err;
      }

      // Stream ended naturally
      this.connected = false;
      this.stopHeartbeatMonitor();
      logger.warn("Filtered stream ended");
      this.emit("disconnect");
    } catch (err: unknown) {
      this.connected = false;
      this.stopHeartbeatMonitor();

      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      logger.error({ err }, "Filtered stream error");
      this.emit("error", err);
      this.emit("disconnect");
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────

  disconnect(): void {
    this.stopHeartbeatMonitor();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connected = false;
    this.connectedAt = null;
  }

  // ── Heartbeat monitoring ──────────────────────────────────────────────

  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor();
    // X API sends heartbeat every 20s; disconnect if nothing received in 30s
    this.heartbeatTimer = setInterval(() => {
      if (!this.lastHeartbeat) return;
      const elapsed = Date.now() - this.lastHeartbeat.getTime();
      if (elapsed > 30_000) {
        logger.warn({ elapsed }, "Stream heartbeat timeout, disconnecting");
        this.disconnect();
        this.emit("disconnect");
      }
    }, 5_000);
  }

  private stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Reconnection with exponential backoff ─────────────────────────────

  getReconnectDelay(): number {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxBackoffMs);
    this.reconnectAttempts++;
    return delay;
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  // ── Status ────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.connected;
  }

  getUptime(): number {
    if (!this.connectedAt) return 0;
    return Date.now() - this.connectedAt;
  }

  getLastHeartbeat(): Date | null {
    return this.lastHeartbeat;
  }
}
