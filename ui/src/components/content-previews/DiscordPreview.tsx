interface DiscordPreviewProps {
  content: string;
  personality?: string;
}

export function DiscordPreview({ content, personality }: DiscordPreviewProps) {
  const charCount = content.length;
  const isOverLimit = charCount > 2000;

  const timestamp = new Date().toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <div className="rounded-xl border border-[#1e1f22] bg-[#313338] p-4 font-sans">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5865f2] text-sm font-bold text-white">
          CD
        </div>

        <div className="flex-1 min-w-0">
          {/* Name line */}
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-medium text-white">
              Coherence Daddy
            </span>
            <span className="rounded bg-[#5865f2] px-1 py-[1px] text-[10px] font-semibold uppercase text-white leading-none">
              BOT
            </span>
            {personality && (
              <span className="rounded bg-[#4e505c] px-1.5 py-[1px] text-[10px] font-medium text-[#b5bac1] leading-none">
                {personality}
              </span>
            )}
            <span className="text-[11px] text-[#949ba4]">{timestamp}</span>
          </div>

          {/* Message content */}
          <div className="mt-1">
            <p className="text-[15px] leading-[1.375rem] text-[#dbdee1] whitespace-pre-wrap break-words">
              {content}
            </p>
          </div>

          {/* Character count */}
          <div className="mt-2 flex justify-end">
            <span
              className={`text-[11px] tabular-nums ${
                isOverLimit ? "text-red-400" : "text-[#949ba4]"
              }`}
            >
              {charCount.toLocaleString()}/2,000
            </span>
          </div>

          {/* Reactions mock */}
          <div className="mt-2 flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-md border border-[#4e505c] bg-[#2b2d31] px-1.5 py-0.5 text-[12px]">
              <span>👍</span>
              <span className="text-[#dbdee1]">3</span>
            </span>
            <span className="flex items-center gap-1 rounded-md border border-[#4e505c] bg-[#2b2d31] px-1.5 py-0.5 text-[12px]">
              <span>🔥</span>
              <span className="text-[#dbdee1]">7</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
