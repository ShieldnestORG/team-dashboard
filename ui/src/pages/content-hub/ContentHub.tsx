import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { socialsApi } from "@/api/socials";
import { KITS, KIT_SYNC_META } from "@/content/marketing-kits";
import { FlowStepper } from "@/components/FlowStepper";
import { HelpTip } from "@/components/HelpTip";
import { CaptionStylePicker } from "./CaptionStylePicker";
import { GreenLightBoard } from "./GreenLightBoard";
import { KitCard } from "./KitCard";
import { formatWhen } from "./kit-status";

const GREENLIGHT_KEY = ["socials", "zernio", "greenlight"];

/**
 * The Content Hub: everything a marketing teammate needs to make and post
 * content, with zero training. Kits come from the committed md-synced module
 * (no server round-trip); the green-light strip reads the fast DB mirror.
 * This page posts and publishes nothing on its own — the only write is the
 * optional "Generate audio" button, which spends a little text-to-speech
 * credit to make a voice line.
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
  // Never surface the server's error message here — a 500 can carry raw
  // technical detail (SQL, upstream jargon) that means nothing to a
  // marketing user. One fixed, plain, actionable line instead.
  const greenlightError = greenlightQuery.error
    ? 'Couldn\'t load the keyword board. Try "Refresh from Zernio now", or tell Mark if it keeps happening.'
    : null;

  const syncDate = formatWhen(KIT_SYNC_META.syncedAt);
  const sourceName = KIT_SYNC_META.sourcePath.split("/").pop() ?? KIT_SYNC_META.sourcePath;

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Content Hub</h1>
        <p className="text-base text-muted-foreground">
          Every content kit in one place. Check a keyword's light, copy what you need, and post.
          Nothing here posts or publishes anywhere — the one thing that costs anything is
          "Generate audio," which uses a little text-to-speech credit.
        </p>
      </header>

      <FlowStepper current="create" createHref="/content-hub" />

      <GreenLightBoard
        rows={rows}
        isLoading={greenlightQuery.isLoading}
        error={greenlightError}
        onRefresh={() => refreshMutation.mutateAsync()}
        refreshing={refreshMutation.isPending}
      />

      <section className="space-y-4">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">The kits</h2>
          <HelpTip label="What is a kit?">
            A kit is a ready-to-use caption, plus any spoken lines and copy-ready snippets, for
            one keyword or campaign. Copy the whole thing and paste it wherever you're posting by
            hand, or load it into Compose, tracked and attributed to you.
          </HelpTip>
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {KITS.map((kit) => (
            <KitCard key={kit.id} kit={kit} greenlightRows={rows} />
          ))}
        </div>
      </section>

      <CaptionStylePicker />

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Synced from {sourceName} §6 · {syncDate} · {KIT_SYNC_META.sha256.slice(0, 8)}
      </footer>
    </div>
  );
}
