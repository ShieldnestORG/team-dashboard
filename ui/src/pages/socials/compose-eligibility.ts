import { COMPOSABLE_PLATFORMS } from "@paperclipai/shared";
import type { SocialAccount } from "../../api/socials";

/**
 * An account is composable when it's active, on a platform Compose knows how
 * to post to, AND — for the media platforms — actually routed through
 * Zernio. A non-Zernio Instagram/TikTok account has no working publisher in
 * this app (see server/src/services/platform-publishers/index.ts: only
 * Zernio and Bluesky implement publishText), so showing it as selectable
 * would only fail later, at relay time, instead of never appearing at all.
 *
 * Pure function — no React, so it's independently unit-testable and reused
 * unchanged by SocialsCompose.tsx.
 */
export function isAccountComposable(a: Pick<SocialAccount, "status" | "platform" | "routing">): boolean {
  if (a.status !== "active") return false;
  if (!COMPOSABLE_PLATFORMS.has(a.platform)) return false;
  if (a.platform === "bluesky") return true;
  return a.routing === "zernio";
}
