import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Copy,
  Mail,
  MousePointerClick,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import {
  directoryListingsApi,
  type CompanyListingRow,
  type ListingTier,
} from "../../api/directoryListings";

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

interface Props {
  companyId: number;
  onClose: () => void;
}

export function ListingDetailDrawer({ companyId, onClose }: Props) {
  const qc = useQueryClient();
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [contactDirty, setContactDirty] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string>("featured");
  const [note, setNote] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  // Fetch the full row from the list cache — avoid duplicate endpoint.
  const { data: listData } = useQuery({
    queryKey: ["directory-listings", "list", "all", "all", ""],
    queryFn: () => directoryListingsApi.list({ limit: 500 }),
  });

  const company: CompanyListingRow | undefined = useMemo(
    () => listData?.items.find((c) => c.id === companyId),
    [listData, companyId],
  );

  useEffect(() => {
    if (company && !contactDirty) {
      setContactEmail(company.contactEmail ?? "");
      setContactName(company.contactName ?? "");
      setContactNotes(company.contactNotes ?? "");
    }
  }, [company, contactDirty]);

  const { data: tiersData } = useQuery({
    queryKey: ["directory-listings", "tiers"],
    queryFn: () => directoryListingsApi.getTiers(),
  });

  const { data: traffic } = useQuery({
    queryKey: ["directory-listings", "traffic", companyId],
    queryFn: () => directoryListingsApi.getTraffic(companyId),
    enabled: !!companyId,
  });

  const { data: eventsData } = useQuery({
    queryKey: ["directory-listings", "events", company?.listing?.id],
    queryFn: () =>
      company?.listing
        ? directoryListingsApi.getEvents(company.listing.id)
        : Promise.resolve({ events: [] }),
    enabled: !!company?.listing,
  });

  const saveContact = useMutation({
    mutationFn: () =>
      directoryListingsApi.updateContact(companyId, {
        email: contactEmail,
        name: contactName,
        notes: contactNotes,
      }),
    onSuccess: () => {
      setContactDirty(false);
      qc.invalidateQueries({ queryKey: ["directory-listings"] });
    },
  });

  const createCheckout = useMutation({
    mutationFn: () =>
      directoryListingsApi.createCheckout({ companyId, tier: selectedTier }),
    onSuccess: (data) => {
      setCheckoutUrl(data.url);
      qc.invalidateQueries({ queryKey: ["directory-listings"] });
    },
  });

  const cancelListing = useMutation({
    mutationFn: () =>
      company?.listing
        ? directoryListingsApi.cancelListing(company.listing.id)
        : Promise.reject(new Error("No listing")),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["directory-listings"] }),
  });

  const addNote = useMutation({
    mutationFn: () =>
      company?.listing
        ? directoryListingsApi.addNote(company.listing.id, note)
        : directoryListingsApi
            .markOutreach(null, companyId)
            .then((r) => directoryListingsApi.addNote(r.listingId, note)),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["directory-listings"] });
    },
  });

  if (!company) return null;

  const tiers: ListingTier[] = tiersData?.tiers ?? [];
  const listing = company.listing;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{company.name}</SheetTitle>
          <SheetDescription>
            {company.category} · <Badge variant="outline">{company.directory}</Badge>
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8 space-y-6">
          {/* Company links */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Links
            </h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" /> Website
                </a>
              )}
              {company.twitterHandle && (
                <a
                  href={`https://x.com/${company.twitterHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent"
                >
                  @{company.twitterHandle}
                </a>
              )}
              {company.githubOrg && (
                <a
                  href={`https://github.com/${company.githubOrg}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent"
                >
                  github.com/{company.githubOrg}
                </a>
              )}
              {company.subreddit && (
                <a
                  href={`https://reddit.com/r/${company.subreddit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent"
                >
                  r/{company.subreddit}
                </a>
              )}
            </div>
          </section>

          {/* Contact */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Contact info (for sales outreach)
            </h3>
            <div className="space-y-2">
              <input
                type="email"
                placeholder="Contact email"
                value={contactEmail}
                onChange={(e) => {
                  setContactEmail(e.target.value);
                  setContactDirty(true);
                }}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <input
                type="text"
                placeholder="Contact name"
                value={contactName}
                onChange={(e) => {
                  setContactName(e.target.value);
                  setContactDirty(true);
                }}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              <textarea
                placeholder="Notes / outreach context"
                value={contactNotes}
                onChange={(e) => {
                  setContactNotes(e.target.value);
                  setContactDirty(true);
                }}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
              />
              {contactDirty && (
                <Button
                  size="sm"
                  onClick={() => saveContact.mutate()}
                  disabled={saveContact.isPending}
                >
                  {saveContact.isPending ? "Saving…" : "Save contact"}
                </Button>
              )}
            </div>
          </section>

          {/* Traffic attribution */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" /> Traffic we've driven
            </h3>
            {traffic ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="border border-border rounded p-2">
                    <div className="text-lg font-bold tabular-nums">
                      {traffic.totals.mentions}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase">
                      Content mentions
                    </div>
                  </div>
                  <div className="border border-border rounded p-2">
                    <div className="text-lg font-bold tabular-nums flex items-center justify-center gap-1">
                      <MousePointerClick className="h-3 w-3" />
                      {traffic.totals.clicks}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase">
                      Clicks driven
                    </div>
                  </div>
                  <div className="border border-border rounded p-2">
                    <div className="text-lg font-bold tabular-nums">
                      {traffic.totals.publishedMentions}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase">
                      Published
                    </div>
                  </div>
                </div>
                {traffic.recentMentions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase">
                      Recent mentions
                    </p>
                    {traffic.recentMentions.slice(0, 5).map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-xs border border-border rounded px-2 py-1"
                      >
                        <span className="truncate flex-1">{m.title}</span>
                        <span className="text-muted-foreground ml-2 shrink-0">
                          {m.platform} · {m.clickCount} clicks
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
          </section>

          {/* Listing status */}
          {listing && (
            <section>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Current listing
              </h3>
              <div className="border border-border rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge>{listing.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tier</span>
                  <span className="capitalize">{listing.tier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monthly</span>
                  <span className="tabular-nums">
                    {formatMoney(listing.monthlyPriceCents)}
                  </span>
                </div>
                {listing.currentPeriodEnd && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Renews</span>
                    <span>
                      {new Date(listing.currentPeriodEnd).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
              {(listing.status === "active" || listing.status === "past_due") && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                  onClick={() => cancelListing.mutate()}
                  disabled={cancelListing.isPending}
                >
                  {cancelListing.isPending ? "Canceling…" : "Cancel subscription"}
                </Button>
              )}
            </section>
          )}

          {/* Send checkout */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Create Stripe checkout link
            </h3>
            {!tiersData?.stripeConfigured && (
              <p className="text-xs text-yellow-500 mb-2">
                ⚠ STRIPE_SECRET_KEY not configured — checkout disabled.
              </p>
            )}
            <div className="flex items-center gap-2">
              <select
                value={selectedTier}
                onChange={(e) => setSelectedTier(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm flex-1"
              >
                {tiers.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label} · {formatMoney(t.monthlyPriceCents)}/mo
                    {!t.stripePriceConfigured ? " (no price)" : ""}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => createCheckout.mutate()}
                disabled={
                  !contactEmail ||
                  createCheckout.isPending ||
                  !tiersData?.stripeConfigured
                }
              >
                <Mail className="h-3 w-3 mr-1" />
                {createCheckout.isPending ? "Creating…" : "Create link"}
              </Button>
            </div>
            {checkoutUrl && (
              <div className="mt-2 p-2 border border-emerald-500/30 bg-emerald-500/5 rounded text-xs">
                <div className="flex items-center gap-1 text-emerald-500 mb-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Checkout link created
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-[10px] bg-background px-2 py-1 rounded">
                    {checkoutUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(checkoutUrl);
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Note + event timeline */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" /> Timeline
            </h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
              />
              <Button
                size="sm"
                onClick={() => addNote.mutate()}
                disabled={!note.trim() || addNote.isPending}
              >
                Add
              </Button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(eventsData?.events ?? []).map((evt) => (
                <div
                  key={evt.id}
                  className="text-xs border border-border rounded px-2 py-1 flex justify-between"
                >
                  <span>
                    <span className="font-medium">{evt.eventType}</span>
                    {evt.toStatus && (
                      <span className="text-muted-foreground">
                        {" → "}
                        {evt.toStatus}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(evt.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
              {(eventsData?.events ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No events yet.</p>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
