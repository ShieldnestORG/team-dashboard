// ---------------------------------------------------------------------------
// Every send carries a plain-text part: the Brevo call and the SMTP fallback
// both pass `text` through when the caller provides one.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBrevoEmail, sendMailBrevoFirst } from "../services/brevo.js";

const fetchMock = vi.fn();
beforeEach(() => {
  process.env.BREVO_API_KEY = "fake-key-test-only";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BREVO_API_KEY;
});

describe("brevo plain-text part", () => {
  it("posts textContent next to htmlContent", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => "" });
    const ok = await sendBrevoEmail({ from: "A <a@x.test>", to: "b@x.test", subject: "S", html: "<p>hi</p>", text: "hi" });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.htmlContent).toBe("<p>hi</p>");
    expect(body.textContent).toBe("hi");
  });

  it("omits textContent when no text is given (callers that predate it are unchanged)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => "" });
    await sendBrevoEmail({ from: "a@x.test", to: "b@x.test", subject: "S", html: "<p>hi</p>" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect("textContent" in body).toBe(false);
  });

  it("passes text to the SMTP fallback when Brevo fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const sendMail = vi.fn(async () => undefined);
    const ok = await sendMailBrevoFirst(
      { from: "a@x.test", to: "b@x.test", subject: "S", html: "<p>hi</p>", text: "hi" },
      { sendMail } as never,
    );
    expect(ok).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>hi</p>", text: "hi" }));
  });
});
