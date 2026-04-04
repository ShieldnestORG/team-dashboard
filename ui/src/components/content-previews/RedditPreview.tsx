import {
  ArrowBigUp,
  ArrowBigDown,
  MessageSquare,
  Share2,
  Bookmark,
  Award,
} from "lucide-react";

interface RedditPreviewProps {
  content: string;
  personality?: string;
}

function extractTitle(content: string): string {
  const firstLine = content.split("\n")[0]?.trim();
  if (firstLine && firstLine.length <= 200) return firstLine;
  return content.slice(0, 100).trimEnd() + "...";
}

function extractBody(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= 1) return "";
  const body = lines.slice(1).join("\n").trim();
  if (body.length <= 300) return body;
  return body.slice(0, 300).trimEnd() + "...";
}

export function RedditPreview({ content, personality }: RedditPreviewProps) {
  const title = extractTitle(content);
  const body = extractBody(content);

  return (
    <div className="rounded-xl border border-zinc-700 bg-[#1a1a1b] font-sans overflow-hidden">
      <div className="flex">
        {/* Vote column */}
        <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 bg-[#161617] py-3">
          <button className="text-zinc-500 transition-colors hover:text-orange-500">
            <ArrowBigUp className="h-5 w-5" />
          </button>
          <span className="text-[12px] font-bold text-zinc-300">128</span>
          <button className="text-zinc-500 transition-colors hover:text-blue-500">
            <ArrowBigDown className="h-5 w-5" />
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 py-2 pr-3 pl-2">
          {/* Subreddit + meta */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
              r/
            </div>
            <span className="font-bold text-zinc-300 hover:underline cursor-pointer">
              r/cryptocurrency
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">
              Posted by{" "}
              <span className="hover:underline cursor-pointer">
                u/CoherenceDaddy
              </span>
            </span>
            {personality && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
                  {personality}
                </span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">1h</span>
          </div>

          {/* Title */}
          <h3 className="mt-1.5 text-[16px] font-medium leading-tight text-zinc-100">
            {title}
          </h3>

          {/* Body */}
          {body && (
            <p className="mt-2 text-[14px] leading-relaxed text-zinc-400 whitespace-pre-wrap break-words">
              {body}
            </p>
          )}

          {/* Bottom bar */}
          <div className="mt-3 flex items-center gap-1 -ml-1">
            {[
              { icon: MessageSquare, label: "24 Comments" },
              { icon: Share2, label: "Share" },
              { icon: Bookmark, label: "Save" },
              { icon: Award, label: "Award" },
            ].map(({ icon: Icon, label }) => (
              <button
                key={label}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold text-zinc-500 transition-colors hover:bg-zinc-800"
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
