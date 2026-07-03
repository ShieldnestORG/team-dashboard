import { useState } from "react";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "@/lib/router";
import type { MarketingKit } from "@/content/marketing-kits";
import type { ZernioGreenlightRow } from "@/api/socials";
import { CopyButton } from "./CopyButton";
import { VoiceChip } from "./VoiceChip";
import {
  describeGreenlightRow,
  kitLiveStatus,
  personaName,
  staticStatusLabel,
  staticStatusTone,
  toneDotClassName,
} from "./kit-status";

function StatusLine({ kit, rows }: { kit: MarketingKit; rows: ZernioGreenlightRow[] }) {
  const status = kitLiveStatus(kit, rows);
  if (status.source === "live") {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneDotClassName(status.row.tone)}`} />
        <span>{describeGreenlightRow(status.row)}</span>
      </span>
    );
  }
  if (status.source === "plan") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full opacity-60 ${toneDotClassName(staticStatusTone(status.staticStatus))}`}
        />
        <span>{staticStatusLabel(status.staticStatus)}</span>
      </span>
    );
  }
  return null;
}

/**
 * One kit, one card. The calm view is title + status + "Copy the whole kit";
 * the full contents (verbatim block, per-field copy, voice chips) sit behind
 * one tap. "Copy the whole kit" copies the kit's fenced block byte-exact
 * from the md-synced module — emoji and accents intact.
 */
export function KitCard({ kit, greenlightRows }: { kit: MarketingKit; greenlightRows: ZernioGreenlightRow[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const hasConflictingClickTags = (kit.clickTags?.length ?? 0) > 1;

  function sendToCompose() {
    navigate("/socials?tab=compose", { state: { prefillText: kit.raw } });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-start gap-2 text-base">
          <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted-foreground">KIT {kit.id}</span>
          <span className="flex-1">{kit.title}</span>
        </CardTitle>
        {kit.subtitle && <p className="text-sm text-muted-foreground">{kit.subtitle}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {kit.keyword && (
            <Badge className="border-[#FF6B4A]/40 bg-[#FF6B4A]/10 text-[#FF6B4A]" variant="outline">
              {kit.keyword}
            </Badge>
          )}
          {kit.account && <span className="text-xs text-muted-foreground">{kit.account}</span>}
        </div>
        <StatusLine kit={kit} rows={greenlightRows} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            text={kit.raw}
            label="Copy the whole kit"
            variant="default"
            className="bg-[#FF6B4A] text-white hover:bg-[#FF6B4A]/90"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {open ? "Hide the details" : "Show everything in this kit"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={sendToCompose}
            title="Load this kit's caption into Socials Compose, tracked and attributed to you"
          >
            <Send className="h-4 w-4" />
            Send to Compose
          </Button>
        </div>

        {open && (
          <div className="space-y-5">
            {hasConflictingClickTags && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-200">
                This kit has two click tags. The keyword doc says{" "}
                <code className="font-mono">{kit.clickTags![0]}</code>; the live automation uses{" "}
                <code className="font-mono">{kit.clickTags![1]}</code>. Both are real — check with Mark
                before relying on one.
              </div>
            )}

            {kit.spokenLines.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  Spoken lines — read by {personaName(kit.voiceKey ?? kit.spokenLines[0]!.voiceKey)}
                </h3>
                {kit.spokenLines.map((line) => (
                  <div key={line.label} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-sm font-medium">{line.label}</span>
                      <CopyButton text={line.text} label="Copy" variant="ghost" />
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{line.text}</p>
                    <VoiceChip line={line} kitId={kit.id} />
                  </div>
                ))}
              </section>
            )}

            {kit.fields.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Copy one piece</h3>
                {kit.fields.map((field) => (
                  <div
                    key={field.label}
                    className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{field.label}</div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {field.value}
                      </p>
                    </div>
                    <CopyButton text={field.value} label="Copy" variant="ghost" className="shrink-0" />
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">The whole kit, word for word</h3>
              <div className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap text-xs">{kit.raw}</pre>
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
