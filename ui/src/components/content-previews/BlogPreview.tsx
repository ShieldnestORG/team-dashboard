import { Clock, ArrowRight, User } from "lucide-react";

interface BlogPreviewProps {
  content: string;
  personality?: string;
  title?: string;
}

function extractTitle(content: string, fallbackTitle?: string): string {
  if (fallbackTitle) return fallbackTitle;
  // Try to extract from markdown heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];
  // Use first line
  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length <= 120) return firstLine;
  return "Untitled Post";
}

function extractExcerpt(content: string): string {
  // Remove markdown heading if present
  const body = content.replace(/^#\s+.+$/m, "").trim();
  if (body.length <= 200) return body;
  return body.slice(0, 200).trimEnd() + "...";
}

function estimateReadingTime(content: string): number {
  const words = content.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function BlogPreview({ content, personality, title }: BlogPreviewProps) {
  const resolvedTitle = extractTitle(content, title);
  const excerpt = extractExcerpt(content);
  const readTime = estimateReadingTime(content);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden font-sans">
      {/* Category badge */}
      <div className="px-6 pt-5">
        <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          Blog Post
        </span>
      </div>

      {/* Title */}
      <div className="px-6 pt-3">
        <h2 className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">
          {resolvedTitle}
        </h2>
      </div>

      {/* Meta line */}
      <div className="flex items-center gap-3 px-6 pt-2.5">
        <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
          <User className="h-3.5 w-3.5" />
          <span className="text-[13px]">Coherence Daddy</span>
        </div>
        {personality && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-400">
            {personality}
          </span>
        )}
        <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
          <Clock className="h-3.5 w-3.5" />
          <span className="text-[13px]">{readTime} min read</span>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-6 mt-4 border-t border-zinc-100 dark:border-zinc-800" />

      {/* Excerpt */}
      <div className="px-6 pt-4">
        <p className="text-[14px] leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
          {excerpt}
        </p>
      </div>

      {/* Read more */}
      <div className="px-6 py-4">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline">
          Read more
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}
