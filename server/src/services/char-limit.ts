import { logger } from "../middleware/logger.js";

export function smartTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = limit - 1;
  const window = text.slice(0, room);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("\n"),
  );
  if (sentenceEnd >= room * 0.6) {
    return text.slice(0, sentenceEnd + 1).trimEnd();
  }
  const wordEnd = window.lastIndexOf(" ");
  if (wordEnd >= room * 0.5) {
    return text.slice(0, wordEnd).trimEnd() + "…";
  }
  return text.slice(0, room).trimEnd() + "…";
}

export async function enforceCharLimit(
  initialText: string,
  charLimit: number,
  callOllama: (prompt: string) => Promise<string>,
  buildStrictPrompt: (attempt: number) => string,
  ctx: { personalityId: string; contentType: string },
): Promise<string> {
  let text = initialText;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (text.length <= charLimit) return text;
    logger.warn(
      { ...ctx, attempt, charCount: text.length, charLimit },
      "Content exceeded char limit — retrying with stricter prompt",
    );
    try {
      text = await callOllama(buildStrictPrompt(attempt));
    } catch (err) {
      logger.warn({ err, ...ctx }, "Strict-prompt retry failed; falling through to truncation");
      break;
    }
  }
  if (text.length > charLimit) {
    const truncated = smartTruncate(text, charLimit);
    logger.warn(
      { ...ctx, originalLen: text.length, truncatedLen: truncated.length, charLimit },
      "Content still over limit after retries — truncated",
    );
    return truncated;
  }
  return text;
}
