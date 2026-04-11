import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { partnersApi, type Partner, type CreatePartnerInput } from "../api/partners";
import {
  Handshake, Plus, Trash2, Pencil, X, Save, ExternalLink,
  MousePointerClick, FileText, TrendingUp, Users, Eye,
  Copy, CheckCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDUSTRIES = [
  "fitness", "dining", "wellness", "auto", "salon",
  "retail", "tech", "realestate", "education", "other",
] as const;

const TIERS = ["proof", "partner", "premium"] as const;

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  paused: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  churned: "bg-red-500/20 text-red-400 border-red-500/30",
};

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface PartnerFormState {
  name: string;
  industry: string;
  location: string;
  website: string;
  description: string;
  services: string;
  contactName: string;
  contactEmail: string;
  tier: string;
  referralFeePerClient: string;
  monthlyFee: string;
}

const EMPTY_FORM: PartnerFormState = {
  name: "",
  industry: "fitness",
  location: "",
  website: "",
  description: "",
  services: "",
  contactName: "",
  contactEmail: "",
  tier: "proof",
  referralFeePerClient: "",
  monthlyFee: "",
};

function formFromPartner(p: Partner): PartnerFormState {
  return {
    name: p.name,
    industry: p.industry,
    location: p.location ?? "",
    website: p.website ?? "",
    description: p.description ?? "",
    services: p.services?.join(", ") ?? "",
    contactName: p.contactName ?? "",
    contactEmail: p.contactEmail ?? "",
    tier: p.tier,
    referralFeePerClient: p.referralFeePerClient != null ? (p.referralFeePerClient / 100).toFixed(2) : "",
    monthlyFee: p.monthlyFee != null ? (p.monthlyFee / 100).toFixed(2) : "",
  };
}

function formToInput(f: PartnerFormState): CreatePartnerInput {
  const input: CreatePartnerInput = {
    name: f.name.trim(),
    industry: f.industry,
  };
  if (f.location.trim()) input.location = f.location.trim();
  if (f.website.trim()) input.website = f.website.trim();
  if (f.description.trim()) input.description = f.description.trim();
  if (f.services.trim()) input.services = f.services.split(",").map((s) => s.trim()).filter(Boolean);
  if (f.contactName.trim()) input.contactName = f.contactName.trim();
  if (f.contactEmail.trim()) input.contactEmail = f.contactEmail.trim();
  if (f.tier) input.tier = f.tier;
  if (f.referralFeePerClient.trim()) input.referralFeePerClient = Math.round(parseFloat(f.referralFeePerClient) * 100);
  if (f.monthlyFee.trim()) input.monthlyFee = Math.round(parseFloat(f.monthlyFee) * 100);
  return input;
}

// ---------------------------------------------------------------------------
// Inline Form Component
// ---------------------------------------------------------------------------

function PartnerForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: PartnerFormState;
  onSave: (form: PartnerFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<PartnerFormState>(initial);
  const set = (key: keyof PartnerFormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Name *</label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Business name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Industry *</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.industry}
              onChange={(e) => set("industry", e.target.value)}
            >
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Location</label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="City, State" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Website</label>
            <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Brief description" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Services (comma-separated)</label>
            <Input value={form.services} onChange={(e) => set("services", e.target.value)} placeholder="haircuts, coloring, styling" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contact Name</label>
            <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="John Doe" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Contact Email</label>
            <Input value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="john@example.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tier</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.tier}
              onChange={(e) => set("tier", e.target.value)}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Referral Fee ($/client/mo)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.referralFeePerClient}
              onChange={(e) => set("referralFeePerClient", e.target.value)}
              placeholder="12.50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Monthly Fee ($)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.monthlyFee}
              onChange={(e) => set("monthlyFee", e.target.value)}
              placeholder="99.00"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button size="sm" disabled={!form.name.trim() || !form.industry || saving} onClick={() => onSave(form)}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function Partners() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Partners" }]);
  }, [setBreadcrumbs]);

  // ---- Queries & Mutations ------------------------------------------------

  const { data, isLoading } = useQuery({
    queryKey: ["partners"],
    queryFn: () => partnersApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreatePartnerInput) => partnersApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ slug, updates }: { slug: string; updates: Partial<Partner> }) =>
      partnersApi.update(slug, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      setEditingSlug(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => partnersApi.delete(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    },
  });

  // ---- Derived data -------------------------------------------------------

  const partners = data?.partners ?? [];

  const filtered = partners.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.industry.toLowerCase().includes(q) ||
      (p.location ?? "").toLowerCase().includes(q)
    );
  });

  const totalActive = partners.filter((p) => p.status === "active" || p.status === "trial").length;
  const totalClicks = partners.reduce((sum, p) => sum + (p.totalClicks ?? 0), 0);
  const totalMentions = partners.reduce((sum, p) => sum + (p.contentMentions ?? 0), 0);

  // ---- Handlers -----------------------------------------------------------

  function handleCreate(form: PartnerFormState) {
    createMutation.mutate(formToInput(form));
  }

  function handleUpdate(slug: string, form: PartnerFormState) {
    updateMutation.mutate({ slug, updates: formToInput(form) as Partial<Partner> });
  }

  function handleDelete(slug: string, name: string) {
    if (!window.confirm(`Delete partner "${name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(slug);
  }

  function handleCopyDashboardLink(slug: string, token: string | null) {
    if (!token) return;
    const url = `${window.location.origin}/api/partners/${slug}/dashboard?token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  }

  // ---- Render -------------------------------------------------------------

  if (isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{partners.length}</p>
              <p className="text-xs text-muted-foreground">Total Partners</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalActive}</p>
              <p className="text-xs text-muted-foreground">Active Partners</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-blue-500/10 p-2">
              <MousePointerClick className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalClicks.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Clicks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-purple-500/10 p-2">
              <FileText className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalMentions.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Content Mentions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="sm:max-w-xs"
          placeholder="Search partners..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button size="sm" onClick={() => { setShowCreate(true); setEditingSlug(null); }}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Partner
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <PartnerForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          saving={createMutation.isPending}
        />
      )}

      {/* Partner List */}
      {filtered.length === 0 && !showCreate ? (
        <EmptyState
          icon={Handshake}
          message={
            search
              ? "No partners match your search."
              : "No partners yet. Add your first partner business to start driving traffic with your AEO content engine."
          }
          action={search ? undefined : "Add Partner"}
          onAction={search ? undefined : () => setShowCreate(true)}
        />
      ) : (
        <div className="grid gap-4">
          {filtered.map((partner) =>
            editingSlug === partner.slug ? (
              <PartnerForm
                key={partner.slug}
                initial={formFromPartner(partner)}
                onSave={(form) => handleUpdate(partner.slug, form)}
                onCancel={() => setEditingSlug(null)}
                saving={updateMutation.isPending}
              />
            ) : (
              <Card key={partner.slug}>
                <CardContent className="py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {/* Left: Info */}
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">{partner.name}</span>
                        <Badge variant="secondary" className="text-xs">{partner.industry}</Badge>
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLORS[partner.status] ?? ""}`}
                        >
                          {partner.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs">{partner.tier}</Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {partner.location && <span>{partner.location}</span>}
                        {partner.website && (
                          <a
                            href={partner.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          >
                            Website <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {partner.referralFeePerClient != null && (
                          <span>${(partner.referralFeePerClient / 100).toFixed(2)}/client/mo</span>
                        )}
                        {partner.monthlyFee != null && (
                          <span>${(partner.monthlyFee / 100).toFixed(2)}/mo fee</span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <MousePointerClick className="h-3 w-3" />
                          {partner.totalClicks.toLocaleString()} clicks
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          {partner.contentMentions.toLocaleString()} mentions
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {partner.dashboardToken && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => handleCopyDashboardLink(partner.slug, partner.dashboardToken)}
                        >
                          {copiedSlug === partner.slug ? (
                            <>
                              <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-500" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Dashboard Link
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => { setEditingSlug(partner.slug); setShowCreate(false); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(partner.slug, partner.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
