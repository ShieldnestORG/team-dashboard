import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Import guard: every navigation primitive must come from the @/lib/router wrapper so
// links get the company prefix applied. Direct react-router-dom imports bypass the
// wrapper and produce unprefixed (404) links — the bug fixed in the Wave 1 routing work.
// The repo has no lint infrastructure, so this test IS the enforcement.

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files allowed to import react-router-dom directly (relative to ui/src). */
const ALLOWLIST = new Set([
  "lib/router.tsx", // the wrapper itself
  "main.tsx", // BrowserRouter setup
  "pages/PartnerDashboard.tsx", // useSearchParams only — no navigation primitives
  "pages/Partners.tsx", // useSearchParams only — no navigation primitives
]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("react-router-dom import guard", () => {
  it("no file outside the wrapper allowlist imports react-router-dom directly", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC_DIR)) {
      const relativePath = path.relative(SRC_DIR, file).split(path.sep).join("/");
      if (ALLOWLIST.has(relativePath)) continue;
      const source = fs.readFileSync(file, "utf8");
      if (/from\s+["']react-router-dom["']/.test(source) || /require\(["']react-router-dom["']\)/.test(source)) {
        offenders.push(relativePath);
      }
    }

    expect(
      offenders,
      `Import Link/NavLink/Navigate/useNavigate (and friends) from "@/lib/router" instead of "react-router-dom" so company prefixes are applied: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("allowlisted useSearchParams-only files stay free of navigation primitives", () => {
    for (const relativePath of ["pages/PartnerDashboard.tsx", "pages/Partners.tsx"]) {
      const source = fs.readFileSync(path.join(SRC_DIR, relativePath), "utf8");
      const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react-router-dom["']/g)]
        .flatMap((match) => match[1]!.split(",").map((name) => name.trim().split(/\s+as\s+/)[0]!.trim()))
        .filter(Boolean);
      const banned = imports.filter((name) => ["Link", "NavLink", "Navigate", "useNavigate"].includes(name));
      expect(banned, `${relativePath} must not pull navigation primitives from react-router-dom`).toEqual([]);
    }
  });
});
