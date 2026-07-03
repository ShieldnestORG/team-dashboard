// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KITS } from "@/content/marketing-kits";
import { KitCard } from "./KitCard";

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

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((el) =>
    el.textContent?.includes(text),
  );
  if (!button) throw new Error(`No button containing "${text}"`);
  return button;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

describe("KitCard copy fidelity", () => {
  it("'Copy the whole kit' puts the kit's raw block on the clipboard byte-exact (emoji intact)", async () => {
    const kit1 = KITS.find((kit) => kit.id === 1)!;
    render(<KitCard kit={kit1} greenlightRows={[]} />);

    await click(buttonByText("Copy the whole kit"));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0];
    expect(copied).toBe(kit1.raw); // JS string equality is code-point exact
    expect(copied).toContain("→"); // arrows survive
  });

  it("copies accented text (CACHÉ / Spanish) without entity mangling", async () => {
    const kit7 = KITS.find((kit) => kit.id === 7)!;
    render(<KitCard kit={kit7} greenlightRows={[]} />);

    await click(buttonByText("Copy the whole kit"));

    const copied = writeText.mock.calls[0]![0];
    expect(copied).toBe(kit7.raw);
    expect(copied).toContain("CACHÉ");
    expect(copied).not.toContain("&amp;");
    expect(copied).not.toContain("&#");
  });
});

describe("KitCard clickTag conflict (KIT 1)", () => {
  it("shows BOTH clickTags, labeled, when the source doc conflicts", async () => {
    const kit1 = KITS.find((kit) => kit.id === 1)!;
    render(<KitCard kit={kit1} greenlightRows={[]} />);

    await click(buttonByText("Show everything in this kit"));

    expect(container.textContent).toContain("two click tags");
    expect(container.textContent).toContain("ig-room");
    expect(container.textContent).toContain("keyword doc says");
    expect(container.textContent).toContain("live automation uses");
  });
});

describe("KitCard status line", () => {
  it("labels the static fallback explicitly as plan status, not live data", () => {
    const kit4 = KITS.find((kit) => kit.id === 4)!; // SCORE — staticStatus "plan"
    render(<KitCard kit={kit4} greenlightRows={[]} />);
    expect(container.textContent).toContain("Plan status: plan — not live data.");
  });

  it("shows the live green-light state when Zernio has the keyword", () => {
    const kit1 = KITS.find((kit) => kit.id === 1)!;
    render(
      <KitCard
        kit={kit1}
        greenlightRows={[
          {
            keyword: "ROOM",
            automationName: "ROOM",
            zernioAccountId: "z1",
            accountLabel: "@coherencedaddy",
            clickTag: "room",
            isActive: true,
            lastSyncedAt: new Date().toISOString(),
            stats: { triggered: 5, dmsSent: 2, linkClicks: 1 },
            tone: "green",
            addonMissing: false,
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("Live — safe to post.");
    expect(container.textContent).not.toContain("Plan status");
  });
});
