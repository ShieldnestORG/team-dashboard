// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { VoiceSnippetResult } from "@/api/voice-snippets";
import { VoiceChip } from "./VoiceChip";

vi.mock("@/api/voice-snippets", () => ({
  voiceSnippetsApi: { generate: vi.fn() },
}));
const { voiceSnippetsApi } = await import("@/api/voice-snippets");
const generateMock = vi.mocked(voiceSnippetsApi.generate);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const LINE = {
  voiceKey: "mark",
  label: "ROOM — Instagram",
  text: "If you want the honest version of this — comment ROOM and I'll DM it to you.",
};

const RESULT: VoiceSnippetResult = {
  assetId: "a1",
  contentPath: "/api/assets/a1/content",
  voiceName: "Mark",
  durationSec: 12,
  byteSize: 192_000,
  cached: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  generateMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(<VoiceChip line={LINE} kitId={1} />));
}

function generateButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((el) =>
    el.textContent?.includes("Generate audio"),
  );
  if (!button) throw new Error("No Generate audio button");
  return button;
}

describe("VoiceChip", () => {
  it("idle: shows the persona name and a Generate button — and does NOT generate on mount", () => {
    render();
    expect(container.textContent).toContain("Mark's voice");
    expect(generateButton()).toBeTruthy();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("click → loading → player with play/download/drag-out", async () => {
    let resolve!: (value: VoiceSnippetResult) => void;
    generateMock.mockReturnValue(new Promise<VoiceSnippetResult>((r) => (resolve = r)));
    render();

    await act(async () => {
      generateButton().click();
    });
    expect(container.textContent).toContain("Making the audio…");
    expect(generateMock).toHaveBeenCalledWith({
      voiceKey: "mark",
      text: LINE.text,
      kitId: 1,
      field: LINE.label,
    });

    await act(async () => {
      resolve(RESULT);
    });

    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("/api/assets/a1/content");
    const download = container.querySelector("a[download]");
    expect(download?.getAttribute("href")).toBe("/api/assets/a1/content");
    expect(download?.getAttribute("download")).toBe("voice-mark-room-instagram.mp3");
    expect(container.querySelector("[draggable]")).toBeTruthy();
    expect(container.textContent).toContain("~12s");
    expect(container.textContent).toContain("freshly made");
  });

  it("says when the audio was made earlier (server cache hit)", async () => {
    generateMock.mockResolvedValue({ ...RESULT, cached: true });
    render();
    await act(async () => {
      generateButton().click();
    });
    expect(container.textContent).toContain("made earlier — same audio");
  });

  it("503 shows the plain-English not-set-up message with a retry", async () => {
    generateMock.mockRejectedValue(
      new ApiError(
        "Voice generation isn't set up yet — the server is missing its voice key. Tell Mark.",
        503,
        { error: "Voice generation isn't set up yet — the server is missing its voice key. Tell Mark." },
      ),
    );
    render();
    await act(async () => {
      generateButton().click();
    });
    expect(container.textContent).toContain("Voice generation isn't set up yet");
    expect(container.textContent).toContain("Tell Mark");
    expect(container.textContent).toContain("Try again");
  });

  it("unknown failures get a calm generic message", async () => {
    generateMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render();
    await act(async () => {
      generateButton().click();
    });
    expect(container.textContent).toContain("Couldn't make the audio. Try again in a minute.");
  });
});
