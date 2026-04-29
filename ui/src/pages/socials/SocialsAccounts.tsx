import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialsApi, type SocialAccount } from "../../api/socials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PLATFORMS = [
  "x", "reddit", "devto", "hn", "instagram", "facebook", "youtube",
  "discord", "bluesky", "linkedin", "substack", "skool", "tiktok", "github",
];
const BRANDS = ["cd", "tokns", "tx", "shieldnest", "directory", "partners", "coherencedaddy", "rizz"];

function connectionVariant(t: string): "default" | "secondary" | "outline" {
  if (t === "oauth") return "default";
  if (t === "api_key") return "secondary";
  return "outline";
}
function automationVariant(m: string): "default" | "secondary" | "outline" {
  if (m === "full_auto") return "default";
  if (m === "assisted") return "secondary";
  return "outline";
}

export function SocialsAccounts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["socials", "accounts"],
    queryFn: () => socialsApi.listAccounts(),
  });
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Partial<SocialAccount>>({
    brand: "cd",
    platform: "x",
    handle: "",
    connectionType: "manual",
    automationMode: "manual",
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<SocialAccount>) => socialsApi.createAccount(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["socials", "accounts"] });
      setShowNew(false);
      setDraft({ brand: "cd", platform: "x", handle: "", connectionType: "manual", automationMode: "manual" });
    },
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => socialsApi.archiveAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "accounts"] }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading accounts…</div>;

  const accounts = data?.accounts ?? [];
  const byBrand = new Map<string, SocialAccount[]>();
  for (const a of accounts) {
    if (!byBrand.has(a.brand)) byBrand.set(a.brand, []);
    byBrand.get(a.brand)!.push(a);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} across {byBrand.size} brand{byBrand.size === 1 ? "" : "s"}
        </div>
        <Button size="sm" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancel" : "Add account"}
        </Button>
      </div>

      {showNew && (
        <Card>
          <CardHeader><CardTitle className="text-base">New social account</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-xs">Brand</div>
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              >
                {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-xs">Platform</div>
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={draft.platform}
                onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
              >
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="space-y-1 col-span-2">
              <div className="text-xs">Handle</div>
              <Input
                value={draft.handle ?? ""}
                onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
                placeholder="@username or URL slug"
              />
            </label>
            <label className="space-y-1 col-span-2">
              <div className="text-xs">Profile URL (optional)</div>
              <Input
                value={draft.profileUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, profileUrl: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs">Connection</div>
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={draft.connectionType}
                onChange={(e) => setDraft({ ...draft, connectionType: e.target.value as SocialAccount["connectionType"] })}
              >
                <option value="manual">manual</option>
                <option value="oauth">oauth</option>
                <option value="api_key">api_key</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-xs">Automation</div>
              <select
                className="w-full rounded border px-2 py-1 text-sm"
                value={draft.automationMode}
                onChange={(e) => setDraft({ ...draft, automationMode: e.target.value as SocialAccount["automationMode"] })}
              >
                <option value="manual">manual</option>
                <option value="assisted">assisted</option>
                <option value="full_auto">full_auto</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="space-y-1 col-span-2">
              <div className="text-xs">Automation notes</div>
              <Input
                value={draft.automationNotes ?? ""}
                onChange={(e) => setDraft({ ...draft, automationNotes: e.target.value })}
                placeholder="e.g. posts via content:twitter cron, Blaze personality"
              />
            </label>
            <div className="col-span-2 flex justify-end">
              <Button size="sm" onClick={() => createMut.mutate(draft)} disabled={!draft.handle}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {[...byBrand.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([brand, list]) => (
        <Card key={brand}>
          <CardHeader>
            <CardTitle className="text-base capitalize">{brand}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div className="font-medium text-sm">
                    {a.platform} · {a.handle}
                  </div>
                  {a.automationNotes && (
                    <div className="text-xs text-muted-foreground">{a.automationNotes}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={connectionVariant(a.connectionType)}>{a.connectionType}</Badge>
                  <Badge variant={automationVariant(a.automationMode)}>{a.automationMode}</Badge>
                  <Badge variant="outline">{a.status}</Badge>
                  {a.profileUrl && (
                    <a className="text-xs underline" href={a.profileUrl} target="_blank" rel="noreferrer">
                      open
                    </a>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => archiveMut.mutate(a.id)}>
                    archive
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {accounts.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No social accounts yet. Run the seed script or add one above.
        </div>
      )}
    </div>
  );
}
