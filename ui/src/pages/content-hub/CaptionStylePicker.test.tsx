// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTION_STYLES } from "@/content/caption-styles";
import { CaptionStylePicker } from "./CaptionStylePicker";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render() {
  act(() => root.render(<CaptionStylePicker />));
}

describe("CaptionStylePicker", () => {
  it("renders one preview card per committed style", () => {
    render();
    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(CAPTION_STYLES.length);
    for (const style of CAPTION_STYLES) {
      const img = images.find((el) => el.getAttribute("src") === style.preview);
      expect(img, `no preview img for ${style.name}`).toBeTruthy();
      expect(img?.getAttribute("alt")).toContain(style.name);
    }
  });

  it("labels the brand look and the default exactly once", () => {
    render();
    // Count leaf elements with the exact badge text — classic's desc also
    // contains the word "default", so a substring match would double-count.
    const leaves = [...container.querySelectorAll("*")].filter((el) => el.children.length === 0);
    const badgeCount = (label: string) =>
      leaves.filter((el) => el.textContent?.trim() === label).length;
    expect(badgeCount("our brand look")).toBe(1);
    expect(badgeCount("default")).toBe(1);
  });

  it("copy button on a card copies the bare style name (the --style value)", async () => {
    render();
    const coralImg = [...container.querySelectorAll("img")].find((el) =>
      el.getAttribute("src")?.includes("coral"),
    );
    const card = coralImg?.closest("figure");
    expect(card).toBeTruthy();
    const button = card?.querySelector("button");
    expect(button?.textContent).toContain("Copy name");
    await act(async () => {
      button?.click();
    });
    expect(writeText).toHaveBeenCalledWith("coral");
  });
});
