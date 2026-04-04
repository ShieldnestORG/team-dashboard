export { TwitterPreview } from "./TwitterPreview";
export { BlogPreview } from "./BlogPreview";
export { LinkedInPreview } from "./LinkedInPreview";
export { DiscordPreview } from "./DiscordPreview";
export { BlueskyPreview } from "./BlueskyPreview";
export { RedditPreview } from "./RedditPreview";

import { TwitterPreview } from "./TwitterPreview";
import { BlogPreview } from "./BlogPreview";
import { LinkedInPreview } from "./LinkedInPreview";
import { DiscordPreview } from "./DiscordPreview";
import { BlueskyPreview } from "./BlueskyPreview";
import { RedditPreview } from "./RedditPreview";

export function PlatformPreview({
  platform,
  content,
  personality,
  title,
}: {
  platform: string;
  content: string;
  personality?: string;
  title?: string;
}) {
  switch (platform) {
    case "twitter":
      return <TwitterPreview content={content} personality={personality} />;
    case "blog_post":
    case "blog":
      return (
        <BlogPreview
          content={content}
          personality={personality}
          title={title}
        />
      );
    case "linkedin":
      return <LinkedInPreview content={content} personality={personality} />;
    case "discord":
      return <DiscordPreview content={content} personality={personality} />;
    case "bluesky":
      return <BlueskyPreview content={content} personality={personality} />;
    case "reddit":
      return <RedditPreview content={content} personality={personality} />;
    default:
      return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400 italic">
            No preview available for platform "{platform}"
          </p>
          <p className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap">
            {content}
          </p>
        </div>
      );
  }
}
