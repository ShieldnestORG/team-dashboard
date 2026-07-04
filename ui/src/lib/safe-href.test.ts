import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href";

describe("safeHref", () => {
  it("passes through http/https URLs", () => {
    expect(safeHref("https://instagram.com/p/abc")).toBe("https://instagram.com/p/abc");
    expect(safeHref("http://example.com/x?y=1")).toBe("http://example.com/x?y=1");
  });

  it("neutralizes javascript:/data:/other schemes to #", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("JavaScript:alert(1)")).toBe("#");
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeHref("vbscript:msgbox(1)")).toBe("#");
    expect(safeHref("file:///etc/passwd")).toBe("#");
  });

  it("neutralizes unparseable strings to #", () => {
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref("")).toBe("#");
    expect(safeHref("//protocol-relative.example")).toBe("#");
  });
});
