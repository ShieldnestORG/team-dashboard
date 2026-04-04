import { ThumbsUp, MessageCircle, Repeat2, Send, Globe } from "lucide-react";

interface LinkedInPreviewProps {
  content: string;
  personality?: string;
}

export function LinkedInPreview({ content, personality }: LinkedInPreviewProps) {
  const charCount = content.length;
  const isOverLimit = charCount > 3000;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 font-sans">
      {/* Profile header */}
      <div className="flex items-start gap-3 p-4 pb-0">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-blue-400 text-sm font-bold text-white">
          CD
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">
              Coherence Daddy
            </span>
            {personality && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                {personality}
              </span>
            )}
          </div>
          <p className="text-[12px] leading-tight text-zinc-500 dark:text-zinc-400">
            508(c)(1)(A) Tech Organization
          </p>
          <div className="mt-0.5 flex items-center gap-1 text-[12px] text-zinc-400 dark:text-zinc-500">
            <span>1h</span>
            <span>·</span>
            <Globe className="h-3 w-3" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-3">
        <p className="text-[14px] leading-[1.5] text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap break-words">
          {content}
        </p>
      </div>

      {/* Character count */}
      <div className="flex justify-end px-4 pt-1.5">
        <span
          className={`text-[11px] tabular-nums ${
            isOverLimit ? "text-red-500" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {charCount.toLocaleString()}/3,000
        </span>
      </div>

      {/* Reaction summary */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        <div className="flex -space-x-1">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-blue-500 text-[10px]">
            👍
          </span>
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-500 text-[10px]">
            ❤️
          </span>
        </div>
        <span className="text-[12px] text-zinc-500 dark:text-zinc-400">42</span>
        <span className="ml-auto text-[12px] text-zinc-500 dark:text-zinc-400">
          8 comments
        </span>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-zinc-200 dark:border-zinc-800" />

      {/* Action bar */}
      <div className="flex items-center justify-around px-2 py-1">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageCircle, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Icon className="h-4 w-4" />
            <span className="text-[12px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
