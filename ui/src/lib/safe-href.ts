// Guard external/stored URLs before they reach an <a href>. Server-side
// write paths validate http(s) where they can, but rows are long-lived and
// other write paths exist — re-check at render so a stored value can never
// become a clickable javascript:/data: link. Third copy of this pattern
// (DailyBrief, Inspiration) extracted into one shared helper.
export function safeHref(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}
