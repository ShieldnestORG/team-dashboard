import { cn } from "../lib/utils";
import { PLATFORM_META, normalizePlatform, platformBadge, platformBadgeDefault } from "../lib/status-colors";

export function PlatformBadge({ platform, showLabel = true }: { platform: string; showLabel?: boolean }) {
  const key = normalizePlatform(platform);
  const meta = PLATFORM_META[key];
  const Icon = meta?.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        platformBadge[key] ?? platformBadgeDefault
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {showLabel ? (meta?.label ?? platform) : null}
    </span>
  );
}
