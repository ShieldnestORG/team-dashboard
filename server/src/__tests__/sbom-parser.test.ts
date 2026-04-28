import { describe, expect, it } from "vitest";
import {
  parsePackageJson,
  parseGoMod,
  extractRepoFromGithubUrl,
} from "../services/sbom-parser.ts";

const REPO = "argoproj/argo-cd";

describe("parsePackageJson", () => {
  it("emits runtime + devDependency edges with correct scope", () => {
    const text = JSON.stringify({
      name: "argo-cd-ui",
      dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
      devDependencies: { vite: "^5.0.0", postcss: "^8.5.10" },
    });
    const edges = parsePackageJson(REPO, text);
    expect(edges).toHaveLength(4);
    const runtime = edges.filter((e) => e.scope === "runtime").map((e) => e.target).sort();
    const dev = edges.filter((e) => e.scope === "devDependency").map((e) => e.target).sort();
    expect(runtime).toEqual(["react", "react-dom"]);
    expect(dev).toEqual(["postcss", "vite"]);
    expect(edges.every((e) => e.source === REPO)).toBe(true);
    expect(edges.every((e) => e.relationship === "depends_on")).toBe(true);
  });

  it("preserves @scope/pkg npm names verbatim", () => {
    const text = JSON.stringify({
      dependencies: { "@aws-sdk/client-s3": "^3", "@scope/weird-name": "*" },
      devDependencies: { "@types/node": "^20" },
    });
    const edges = parsePackageJson(REPO, text);
    const targets = edges.map((e) => e.target).sort();
    expect(targets).toEqual(["@aws-sdk/client-s3", "@scope/weird-name", "@types/node"]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parsePackageJson(REPO, "this is not json {")).toEqual([]);
    expect(parsePackageJson(REPO, "")).toEqual([]);
  });

  it("returns [] when sourceRepo is empty (no slug-overloading)", () => {
    const text = JSON.stringify({ dependencies: { react: "*" } });
    expect(parsePackageJson("", text)).toEqual([]);
  });

  it("ignores peerDependencies and optionalDependencies in v1", () => {
    const text = JSON.stringify({
      dependencies: { a: "*" },
      peerDependencies: { b: "*" },
      optionalDependencies: { c: "*" },
    });
    const edges = parsePackageJson(REPO, text);
    expect(edges.map((e) => e.target)).toEqual(["a"]);
  });
});

describe("parseGoMod", () => {
  it("parses a require block with multiple modules", () => {
    const text = `module github.com/argoproj/argo-cd

go 1.22

require (
\tgithub.com/jackc/pgx/v5 v5.9.0
\tgithub.com/sirupsen/logrus v1.9.3 // indirect
\tk8s.io/api v0.30.0
)
`;
    const edges = parseGoMod(REPO, text);
    const targets = edges.map((e) => e.target).sort();
    expect(targets).toEqual([
      "github.com/jackc/pgx/v5",
      "github.com/sirupsen/logrus",
      "k8s.io/api",
    ]);
    expect(edges.every((e) => e.scope === "runtime")).toBe(true);
    expect(edges.every((e) => e.source === REPO)).toBe(true);
  });

  it("parses single-line require directives", () => {
    const text = `module foo\nrequire github.com/foo/bar v1.0.0\n`;
    const edges = parseGoMod(REPO, text);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).toBe("github.com/foo/bar");
  });

  it("returns [] for empty or non-go.mod input", () => {
    expect(parseGoMod(REPO, "")).toEqual([]);
    expect(parseGoMod(REPO, "module foo\ngo 1.22\n")).toEqual([]);
  });

  it("ignores replace, exclude, retract directives", () => {
    const text = `module foo
require github.com/keep/me v1.0.0
replace github.com/old => github.com/new v2.0.0
exclude github.com/bad v0.1.0
retract v1.2.0
`;
    const edges = parseGoMod(REPO, text);
    expect(edges.map((e) => e.target)).toEqual(["github.com/keep/me"]);
  });
});

describe("extractRepoFromGithubUrl", () => {
  it("extracts owner/repo from a release URL", () => {
    expect(
      extractRepoFromGithubUrl("https://github.com/argoproj/argo-cd/releases/tag/v2.10.0"),
    ).toBe("argoproj/argo-cd");
  });

  it("extracts owner/repo from a commit URL", () => {
    expect(
      extractRepoFromGithubUrl("https://github.com/aws/graph-explorer/commit/abc123"),
    ).toBe("aws/graph-explorer");
  });

  it("strips a trailing .git suffix", () => {
    expect(extractRepoFromGithubUrl("https://github.com/foo/bar.git")).toBe("foo/bar");
  });

  it("returns null for non-github URLs and empty input", () => {
    expect(extractRepoFromGithubUrl("https://gitlab.com/foo/bar")).toBeNull();
    expect(extractRepoFromGithubUrl("")).toBeNull();
    expect(extractRepoFromGithubUrl(null)).toBeNull();
  });
});
