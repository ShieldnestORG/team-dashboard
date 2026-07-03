import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOARD_ROUTE_MANIFEST,
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN = ["CD"] as const;

describe("route walk: BOARD_ROUTE_MANIFEST", () => {
  it("prefixes every board route root under the active company", () => {
    for (const root of BOARD_ROUTE_MANIFEST) {
      expect(applyCompanyPrefix(`/${root}`, "CD", KNOWN)).toBe(`/CD/${root}`);
    }
  });

  it("prefixes every board route root via the loading-window fallback too", () => {
    // While companies are still loading, classification falls back to the static
    // manifest — every root must still resolve (this is what broke the 5 sidebar items).
    for (const root of BOARD_ROUTE_MANIFEST) {
      expect(applyCompanyPrefix(`/${root}`, "CD")).toBe(`/CD/${root}`);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(BOARD_ROUTE_MANIFEST).size).toBe(BOARD_ROUTE_MANIFEST.length);
  });

  it("covers the previously broken sidebar roots", () => {
    for (const root of [
      "site-analytics",
      "owned-sites",
      "shop-sharers",
      "video-edit",
      "watchtower",
      "community-agents",
      "sessions",
      "university-emails",
    ]) {
      expect(BOARD_ROUTE_MANIFEST).toContain(root);
    }
  });

  it("no longer lists stale roots", () => {
    expect(BOARD_ROUTE_MANIFEST).not.toContain("usage");
    expect(BOARD_ROUTE_MANIFEST).not.toContain("partner-dashboard");
  });
});

describe("route walk: sidebar links", () => {
  it("every sidebar 'to' resolves under a company prefix onto a manifest root", () => {
    const sidebarSources = [
      path.join(SRC_DIR, "components", "Sidebar.tsx"),
      path.join(SRC_DIR, "config", "company-sidebars.tsx"),
    ].filter((file) => fs.existsSync(file));
    expect(sidebarSources.length).toBeGreaterThan(0);

    const links = sidebarSources.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return [...source.matchAll(/to="(\/[^"]+)"/g)].map((match) => match[1]!);
    });
    expect(links.length).toBeGreaterThan(10);

    for (const to of links) {
      const resolved = applyCompanyPrefix(to, "CD", KNOWN);
      expect(resolved, `sidebar link ${to} did not resolve under /CD`).toMatch(/^\/CD\//);
      const root = resolved.split("/").filter(Boolean)[1]!;
      expect(BOARD_ROUTE_MANIFEST, `sidebar link ${to} points at a root missing from the manifest`).toContain(root);
    }
  });
});

describe("applyCompanyPrefix", () => {
  it("leaves already-prefixed paths unchanged", () => {
    expect(applyCompanyPrefix("/CD/issues", "CD", KNOWN)).toBe("/CD/issues");
    expect(applyCompanyPrefix("/CD/dashboard", "TOK", ["CD", "TOK"])).toBe("/CD/dashboard");
  });

  it("treats lowercase prefixes as already prefixed (Layout case-corrects on navigation)", () => {
    expect(applyCompanyPrefix("/cd/issues", "CD", KNOWN)).toBe("/cd/issues");
  });

  it("prefixes with the second company's prefix when active", () => {
    expect(applyCompanyPrefix("/dashboard", "TOK", ["CD", "TOK"])).toBe("/TOK/dashboard");
  });

  it("leaves global paths unprefixed", () => {
    expect(applyCompanyPrefix("/auth?next=%2Fx", "CD", KNOWN)).toBe("/auth?next=%2Fx");
    expect(applyCompanyPrefix("/invite/abc", "CD", KNOWN)).toBe("/invite/abc");
    expect(applyCompanyPrefix("/instance/settings/general", "CD", KNOWN)).toBe("/instance/settings/general");
    expect(applyCompanyPrefix("/partner-dashboard/slug", "CD", KNOWN)).toBe("/partner-dashboard/slug");
    expect(applyCompanyPrefix("/", "CD", KNOWN)).toBe("/");
  });

  it("leaves relative paths untouched (App.tsx index Navigate relies on this)", () => {
    expect(applyCompanyPrefix("dashboard", "CD", KNOWN)).toBe("dashboard");
  });

  it("preserves search and hash", () => {
    expect(applyCompanyPrefix("/issues?tab=all#top", "CD", KNOWN)).toBe("/CD/issues?tab=all#top");
  });

  it("prefixes dynamic plugin routes once companies are known", () => {
    expect(applyCompanyPrefix("/some-plugin-route", "CD", KNOWN)).toBe("/CD/some-plugin-route");
  });

  it("loading window: unknown segments are tentatively treated as prefixes", () => {
    // Without known prefixes we cannot tell a plugin route from a company prefix;
    // pre-load links keep the old conservative behavior.
    expect(applyCompanyPrefix("/some-plugin-route", "CD")).toBe("/some-plugin-route");
    expect(applyCompanyPrefix("/some-plugin-route", "CD", [])).toBe("/some-plugin-route");
  });

  it("does nothing without an active company prefix", () => {
    expect(applyCompanyPrefix("/issues", null, KNOWN)).toBe("/issues");
  });
});

describe("extractCompanyPrefixFromPath", () => {
  it("recognizes only real company prefixes when companies are known", () => {
    expect(extractCompanyPrefixFromPath("/CD/issues", KNOWN)).toBe("CD");
    expect(extractCompanyPrefixFromPath("/cd/issues", KNOWN)).toBe("CD");
    expect(extractCompanyPrefixFromPath("/university-emails", KNOWN)).toBeNull();
    expect(extractCompanyPrefixFromPath("/some-plugin-route", KNOWN)).toBeNull();
    expect(extractCompanyPrefixFromPath("/auth", KNOWN)).toBeNull();
  });

  it("falls back to the route-root heuristic while companies load", () => {
    expect(extractCompanyPrefixFromPath("/CD/issues")).toBe("CD");
    expect(extractCompanyPrefixFromPath("/issues")).toBeNull();
    expect(extractCompanyPrefixFromPath("/watchtower")).toBeNull();
  });
});

describe("isBoardPathWithoutPrefix", () => {
  it("flags bare board roots and plugin routes when companies are known", () => {
    expect(isBoardPathWithoutPrefix("/university-emails", KNOWN)).toBe(true);
    expect(isBoardPathWithoutPrefix("/sessions", KNOWN)).toBe(true);
    expect(isBoardPathWithoutPrefix("/some-plugin-route", KNOWN)).toBe(true);
  });

  it("does not flag prefixed, global, or invalid-prefix paths", () => {
    expect(isBoardPathWithoutPrefix("/CD/issues", KNOWN)).toBe(false);
    expect(isBoardPathWithoutPrefix("/auth", KNOWN)).toBe(false);
    // Unknown root followed by a board root looks like an INVALID company prefix —
    // Layout should show the invalid-prefix 404 instead of auto-correcting.
    expect(isBoardPathWithoutPrefix("/XYZ/dashboard", KNOWN)).toBe(false);
  });

  it("falls back to the static manifest while companies load", () => {
    expect(isBoardPathWithoutPrefix("/watchtower")).toBe(true);
    expect(isBoardPathWithoutPrefix("/CD/issues")).toBe(false);
    expect(isBoardPathWithoutPrefix("/some-plugin-route")).toBe(false);
  });
});

describe("toCompanyRelativePath", () => {
  it("strips known company prefixes", () => {
    expect(toCompanyRelativePath("/CD/issues/CD-12?x=1", KNOWN)).toBe("/issues/CD-12?x=1");
    expect(toCompanyRelativePath("/CD/some-plugin-route", KNOWN)).toBe("/some-plugin-route");
  });

  it("keeps unprefixed and global paths unchanged", () => {
    expect(toCompanyRelativePath("/issues", KNOWN)).toBe("/issues");
    expect(toCompanyRelativePath("/auth/login", KNOWN)).toBe("/auth/login");
  });

  it("falls back to the second-segment heuristic without known prefixes", () => {
    expect(toCompanyRelativePath("/CD/issues/CD-12")).toBe("/issues/CD-12");
    expect(toCompanyRelativePath("/CD/university-emails")).toBe("/university-emails");
  });
});
