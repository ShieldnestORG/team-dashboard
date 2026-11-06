// ---------------------------------------------------------------------------
// sendAlert — per-key cooldown + HTML-safe email body.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: Array<{ subject: string; html: string }> = [];
vi.mock("./brevo.js", () => ({
  brevoConfigured: () => true,
  sendMailBrevoFirst: vi.fn(async (mail: { subject: string; html: string }) => {
    sent.push(mail);
    return true;
  }),
}));
import { sendAlert, getRecentAlerts } from "./alerting.js";

const env = { to: process.env.ALERT_EMAIL_TO, from: process.env.ALERT_EMAIL_FROM };
beforeAll(() => {
  process.env.ALERT_EMAIL_TO = "ops@example.test";
  process.env.ALERT_EMAIL_FROM = "alerts@example.test";
});
afterAll(() => {
  process.env.ALERT_EMAIL_TO = env.to;
  process.env.ALERT_EMAIL_FROM = env.from;
});

describe("sendAlert cooldownKey", () => {
  it("keeps one type's alerts for different keys apart, and still cools down per key", async () => {
    await sendAlert("blog_publish_failing", "Blog publish failing: cd", "x", { cooldownKey: "test:cd" });
    await sendAlert("blog_publish_failing", "Blog publish failing: sn", "y", { cooldownKey: "test:sn" });
    await sendAlert("blog_publish_failing", "Blog publish failing: cd", "again", { cooldownKey: "test:cd" });

    const subjects = getRecentAlerts().map((a) => a.subject);
    expect(subjects.filter((s) => s === "Blog publish failing: cd")).toHaveLength(1);
    expect(subjects.filter((s) => s === "Blog publish failing: sn")).toHaveLength(1);
  });
});

describe("sendAlert email body", () => {
  it("escapes HTML in the subject and body", async () => {
    await sendAlert("backup_failed", "a <b> & c", "<html><script>x</script> 401");
    const mail = sent.find((m) => m.subject.includes("a <b> & c"));
    expect(mail?.html).toContain("a &lt;b&gt; &amp; c");
    expect(mail?.html).toContain("&lt;html&gt;&lt;script&gt;x&lt;/script&gt; 401");
    expect(mail?.html).not.toContain("<script>");
  });
});
