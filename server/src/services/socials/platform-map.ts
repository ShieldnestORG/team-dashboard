// Maps `contentItems.contentType` (and X-account slug) to a Socials platform key.
// Keep this small and explicit — the universe of contentTypes is finite.

export type SocialPlatform =
  | "x"
  | "reddit"
  | "devto"
  | "hn"
  | "instagram"
  | "facebook"
  | "youtube"
  | "discord"
  | "bluesky"
  | "linkedin"
  | "substack"
  | "skool"
  | "tiktok"
  | "github";

export function contentTypeToPlatform(contentType: string): SocialPlatform | null {
  switch (contentType) {
    case "tweet":
    case "thread":
      return "x";
    case "linkedin":
      return "linkedin";
    case "discord":
      return "discord";
    case "bluesky":
      return "bluesky";
    case "reddit":
      return "reddit";
    case "video_script":
    case "youtube_short":
      return "youtube";
    case "blog_post":
    case "slideshow_blog":
      // blog posts don't map to a single social platform; surfaced separately.
      return null;
    default:
      return null;
  }
}
