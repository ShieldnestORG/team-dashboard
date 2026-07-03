import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { socialsApi } from "@/api/socials";
import { KITS, KIT_SYNC_META } from "@/content/marketing-kits";
import { GreenLightBoard } from "./GreenLightBoard";
import { KitCard } from "./KitCard";
import { formatWhen } from "./kit-status";

const GREENLIGHT_KEY = ["socials", "zernio", "greenlight"];

/**
 * The Content Hub: everything a marketing teammate needs to make and post
 * content, with zero training. Kits come from the committed md-synced module
 * (no server round-trip); the green-light strip reads the fast DB mirror.
 * This page changes nothing live — every control is copy, play, or read.
 */
export function ContentHub() {
  const queryClient = useQueryClient();

  const greenlightQuery = useQuery({
    queryKey: GREENLIGHT_KEY,
    queryFn: () => socialsApi.getZernioGreenlight(),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // ONE live Zernio fetch (per key) + mirror refresh, then re-read the mirror.
  const refreshMutation = useMutation({
    mutationFn: () => socialsApi.refreshZernioAutomations(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: GREENLIGHT_KEY }),
  });

  const rows = greenlightQuery.data?.rows ?? [];
  const greenlightError = greenlightQuery.error
    ? greenlightQuery.error instanceof Error
      ? greenlightQuery.error.message
      : "Couldn't load the keyword board."
    : null;

  const syncDate = formatWhen(KIT_SYNC_META.syncedAt);
  const sourceName = KIT_SYNC_META.sourcePath.split("/").pop() ?? KIT_SYNC_META.sourcePath;

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Content Hub</h1>
        <p className="text-base text-muted-foreground">
          Every content kit in one place. Check a keyword's light, copy what you need, and post.
          Nothing on this page changes anything live.
        </p>
      </header>

      <GreenLightBoard
        rows={rows}
        isLoading={greenlightQuery.isLoading}
        error={greenlightError}
        onRefresh={() => refreshMutation.mutateAsync()}
        refreshing={refreshMutation.isPending}
      />

      <section className="space-y-4">
        <h2 className="text-base font-semibold">The kits</h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {KITS.map((kit) => (
            <KitCard key={kit.id} kit={kit} greenlightRows={rows} />
          ))}
        </div>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Synced from {sourceName} §6 · {syncDate} · {KIT_SYNC_META.sha256.slice(0, 8)}
      </footer>
    </div>
  );
}
