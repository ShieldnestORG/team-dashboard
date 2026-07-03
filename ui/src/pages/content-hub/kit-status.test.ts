import { describe, expect, it } from "vitest";
import type { ZernioGreenlightRow } from "@/api/socials";
import type { BoardAccessSnapshot } from "@/api/access";
import { KITS } from "@/content/marketing-kits";
import { filterSectionsForMarketing, getSidebarConfig } from "@/config/company-sidebars";
import { isMarketingOnlyAccess } from "@/hooks/useBoardAccess";
import {
  describeGreenlightRow,
  formatStat,
  kitLiveStatus,
  latestSyncedAt,
  personaName,
  snippetFileName,
  staticStatusLabel,
  staticStatusTone,
} from "./kit-status";

function row(over: Partial<ZernioGreenlightRow> = {}): ZernioGreenlightRow {
  return {
    keyword: "ROOM",
    automationName: "ROOM",
    zernioAutomationId: "auto-1",
    zernioAccountId: "z1",
    accountLabel: "@coherencedaddy",
    clickTag: "room",
    isActive: true,
    lastSyncedAt: "2026-07-02T10:00:00.000Z",
    stats: { triggered: 12, dmsSent: 8, linkClicks: 3 },
    tone: "green",
    addonMissing: false,
    ...over,
  };
}

describe("describeGreenlightRow", () => {
  it("green reads as safe to post", () => {
    expect(describeGreenlightRow(row())).toBe("Live — safe to post.");
  });

  it("red reads as don't post", () => {
    expect(describeGreenlightRow(row({ tone: "red", isActive: false }))).toBe(
      "Not live — don't post this keyword yet.",
    );
  });

  it("amber with the addon gate names the add-on, never fakes zeros", () => {
    expect(describeGreenlightRow(row({ tone: "amber", addonMissing: true }))).toContain(
      "analytics add-on not active",
    );
  });

  it("plain amber reads as possibly out of date", () => {
    expect(describeGreenlightRow(row({ tone: "amber" }))).toBe(
      "Live, but the numbers may be out of date.",
    );
  });
});

describe("formatStat", () => {
  it("renders null as 'not reported', never 0", () => {
    expect(formatStat(null)).toBe("not reported");
  });

  it("renders real numbers as-is (0 included — a real zero is honest)", () => {
    expect(formatStat(0)).toBe("0");
    expect(formatStat(42)).toBe("42");
  });
});

describe("kitLiveStatus", () => {
  it("joins a kit to its live row by keyword, case-insensitively", () => {
    const status = kitLiveStatus({ keyword: "room", staticStatus: "live" }, [row()]);
    expect(status).toEqual({ source: "live", row: row() });
  });

  it("prefers the healthiest row when the keyword runs on several accounts", () => {
    const status = kitLiveStatus({ keyword: "ROOM" }, [
      row({ zernioAccountId: "z2", tone: "red", isActive: false }),
      row({ zernioAccountId: "z1", tone: "green" }),
    ]);
    expect(status.source).toBe("live");
    if (status.source === "live") expect(status.row.tone).toBe("green");
  });

  it("falls back to the hand-maintained plan status when Zernio has no row", () => {
    expect(kitLiveStatus({ keyword: "RESPIRE", staticStatus: "defer" }, [row()])).toEqual({
      source: "plan",
      staticStatus: "defer",
    });
  });

  it("returns none when there is neither a live row nor a plan status", () => {
    expect(kitLiveStatus({}, [])).toEqual({ source: "none" });
  });
});

describe("staticStatusTone", () => {
  it("maps live/plan/defer to green/amber/red", () => {
    expect(staticStatusTone("live")).toBe("green");
    expect(staticStatusTone("plan")).toBe("amber");
    expect(staticStatusTone("defer")).toBe("red");
  });
});

describe("staticStatusLabel", () => {
  it("maps every plan-status enum to a plain sentence — the raw enum never leaks", () => {
    expect(staticStatusLabel("live")).toBe(
      "Marked ready in the plan — check the keyword board above for live numbers.",
    );
    expect(staticStatusLabel("plan")).toBe("Planned — not running yet.");
    expect(staticStatusLabel("defer")).toBe("On hold for now — don't post this one.");
    // No label is ever the bare enum or contradicts itself.
    for (const status of ["live", "plan", "defer"] as const) {
      expect(staticStatusLabel(status)).not.toBe(status);
      expect(staticStatusLabel(status)).not.toContain("not live data");
    }
  });
});

describe("latestSyncedAt", () => {
  it("returns the newest sync time", () => {
    expect(
      latestSyncedAt([
        row({ lastSyncedAt: "2026-07-01T00:00:00.000Z" }),
        row({ lastSyncedAt: "2026-07-02T12:00:00.000Z" }),
        row({ lastSyncedAt: null }),
      ]),
    ).toBe("2026-07-02T12:00:00.000Z");
  });

  it("returns null when nothing synced yet", () => {
    expect(latestSyncedAt([row({ lastSyncedAt: null })])).toBeNull();
  });
});

describe("personaName", () => {
  it("shows persona labels, never raw ElevenLabs voice names", () => {
    expect(personaName("mark")).toBe("Mark");
    expect(personaName("solene")).toBe("Solène");
    expect(personaName("mami")).toBe("Mami");
  });
});

describe("snippetFileName", () => {
  it("builds a safe mp3 filename from accented labels", () => {
    expect(snippetFileName("solene", "Voice snippet (~20s, read as-is)")).toBe(
      "voice-solene-voice-snippet-20s-read-as-is.mp3",
    );
    expect(snippetFileName("mami", "CACHÉ — línea hablada")).toBe("voice-mami-cache-linea-hablada.mp3");
  });
});

describe("committed kit data (UI expectations)", () => {
  it("KIT 1 carries BOTH clickTags — the source-doc conflict is surfaced, not averaged", () => {
    const kit1 = KITS.find((kit) => kit.id === 1)!;
    expect(kit1.clickTags).toEqual(["ig-room", "room"]);
  });
});

describe("marketing-role sidebar filter", () => {
  it("keeps only Content & Socials (with Content Hub inside) for marketing users", () => {
    const filtered = filterSectionsForMarketing(getSidebarConfig("CD"));
    expect(filtered).toHaveLength(1);
    const section = filtered[0]!;
    expect(section.kind).toBe("items");
    if (section.kind === "items") {
      expect(section.label).toBe("Content & Socials");
      expect(section.items.map((item) => item.to)).toEqual([
        "/socials",
        "/content-hub",
        "/daily-brief",
        "/inspiration",
      ]);
    }
  });

  it("drops the structural projects/agents slots for marketing users", () => {
    const filtered = filterSectionsForMarketing(getSidebarConfig("CD"));
    expect(filtered.some((section) => section.kind === "projects")).toBe(false);
    expect(filtered.some((section) => section.kind === "agents")).toBe(false);
  });
});

describe("isMarketingOnlyAccess", () => {
  const base: BoardAccessSnapshot = {
    user: { id: "u1", name: "Eagan", email: "e@example.com" },
    userId: "u1",
    isInstanceAdmin: false,
    companyIds: ["c1"],
    memberships: [{ companyId: "c1", role: "marketing" }],
    source: "session",
    keyId: null,
  };

  it("true only when every membership is marketing and not instance admin", () => {
    expect(isMarketingOnlyAccess(base)).toBe(true);
  });

  it("false for instance admins even with marketing memberships", () => {
    expect(isMarketingOnlyAccess({ ...base, isInstanceAdmin: true })).toBe(false);
  });

  it("false for plain members and mixed roles", () => {
    expect(
      isMarketingOnlyAccess({ ...base, memberships: [{ companyId: "c1", role: "member" }] }),
    ).toBe(false);
    expect(
      isMarketingOnlyAccess({
        ...base,
        memberships: [
          { companyId: "c1", role: "marketing" },
          { companyId: "c2", role: "member" },
        ],
      }),
    ).toBe(false);
  });

  it("false with no memberships or no snapshot", () => {
    expect(isMarketingOnlyAccess({ ...base, memberships: [] })).toBe(false);
    expect(isMarketingOnlyAccess(null)).toBe(false);
  });
});
