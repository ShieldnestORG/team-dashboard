import { MessageCircle, Repeat2, Heart } from "lucide-react";

interface BlueskyPreviewProps {
  content: string;
  personality?: string;
}

export function BlueskyPreview({ content, personality }: BlueskyPreviewProps) {
  const charCount = content.length;
  const isOverLimit = charCount > 300;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 font-sans">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-sm font-bold text-white">
          CD
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-semibold text-zinc-100">
              Coherence Daddy
            </span>
            {personality && (
              <span className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                {personality}
              </span>
            )}
          </div>
          <span className="text-[13px] text-zinc-500">
            @coherencedaddy.bsky.social
          </span>
        </div>
        <span className="text-[12px] text-zinc-600">1h</span>
      </div>

      {/* Content */}
      <div className="mt-3 pl-[52px]">
        <p className="text-[15px] leading-[1.45] text-zinc-200 whitespace-pre-wrap break-words">
          {content}
        </p>

        {/* Character count */}
        <div className="mt-2 flex justify-end">
          <span
            className={`text-[11px] tabular-nums ${
              isOverLimit ? "text-red-400" : "text-zinc-600"
            }`}
          >
            {charCount}/300
          </span>
        </div>

        {/* Action bar */}
        <div className="mt-3 flex items-center gap-8 border-t border-zinc-800/60 pt-3 text-zinc-600">
          <button className="flex items-center gap-1.5 transition-colors hover:text-sky-400">
            <MessageCircle className="h-[17px] w-[17px]" />
            <span className="text-[13px]">4</span>
          </button>
          <button className="flex items-center gap-1.5 transition-colors hover:text-green-400">
            <Repeat2 className="h-[17px] w-[17px]" />
            <span className="text-[13px]">18</span>
          </button>
          <button className="flex items-center gap-1.5 transition-colors hover:text-pink-400">
            <Heart className="h-[17px] w-[17px]" />
            <span className="text-[13px]">93</span>
          </button>
        </div>
      </div>
    </div>
  );
}
