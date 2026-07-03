import { Badge } from "@/components/ui/badge";
import { CAPTION_STYLES, CAPTION_STYLE_SYNC_META } from "@/content/caption-styles";
import { CopyButton } from "./CopyButton";
import { formatWhen } from "./kit-status";

/**
 * Caption-look menu for clip production. Pure asset layer: thumbnails are
 * pre-rendered at sync time by the caption tool itself (see the generated
 * module header), so what you see here is exactly what a burn produces.
 * Nothing on this section renders video or changes anything live — the team
 * copies a style name and hands it to their Claude, which runs
 * `caption_clip.py --style <name>` on the clip.
 */
export function CaptionStylePicker() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Caption styles</h2>
        <p className="text-sm text-muted-foreground">
          Ready-made caption looks for video clips. Pick the look you want, copy its name, and
          include it when you ask Claude to caption a clip — for example: “caption this clip,
          coral style”.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {CAPTION_STYLES.map((style) => (
          <figure key={style.name} className="flex flex-col gap-2">
            <img
              src={style.preview}
              alt={`${style.name} captions — ${style.desc}`}
              loading="lazy"
              className="w-full rounded-md border border-border"
            />
            <figcaption className="flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{style.name}</span>
                {style.isBrand && <Badge variant="secondary">our brand look</Badge>}
                {style.isDefault && <Badge variant="outline">default</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{style.desc}</p>
            </figcaption>
            <CopyButton text={style.name} label="Copy name" className="w-full" />
          </figure>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Previews rendered by the caption tool from its own presets ·{" "}
        {formatWhen(CAPTION_STYLE_SYNC_META.syncedAt)} · sample line: “
        {CAPTION_STYLE_SYNC_META.sampleText}”
      </p>
    </section>
  );
}
