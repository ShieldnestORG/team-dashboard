import { MessageCircle, Repeat2, Heart, Share, BadgeCheck } from "lucide-react";

interface TwitterPreviewProps {
  content: string;
  personality?: string;
}

export function TwitterPreview({ content, personality }: TwitterPreviewProps) {
  const charCount = content.length;
  const isOverLimit = charCount > 280;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 font-sans">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-bold text-white">
          CD
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[15px] font-bold text-zinc-100">Coherence Daddy</span>
            <BadgeCheck className="h-[18px] w-[18px] fill-blue-500 text-zinc-900" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-zinc-500">@coherencedaddy</span>
            <span className="text-zinc-600">·</span>
            <span className="text-[13px] text-zinc-500">1h</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mt-3 pl-[52px]">
        <p className="text-[15px] leading-[1.4] text-zinc-100 whitespace-pre-wrap break-words">
          {content}
        </p>

        {/* Personality tag */}
        {personality && (
          <span className="mt-2 inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
            {personality}
          </span>
        )}

        {/* Character count */}
        <div className="mt-2 flex justify-end">
          <span
            className={`text-xs tabular-nums ${
              isOverLimit ? "text-red-400" : "text-zinc-500"
            }`}
          >
            {charCount}/280
          </span>
        </div>

        {/* Action bar */}
        <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 text-zinc-500">
          <button className="group flex items-center gap-1.5 transition-colors hover:text-blue-400">
            <MessageCircle className="h-[18px] w-[18px]" />
            <span className="text-[13px]">12</span>
          </button>
          <button className="group flex items-center gap-1.5 transition-colors hover:text-green-400">
            <Repeat2 className="h-[18px] w-[18px]" />
            <span className="text-[13px]">48</span>
          </button>
          <button className="group flex items-center gap-1.5 transition-colors hover:text-pink-400">
            <Heart className="h-[18px] w-[18px]" />
            <span className="text-[13px]">256</span>
          </button>
          <button className="group flex items-center gap-1.5 transition-colors hover:text-blue-400">
            <Share className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
