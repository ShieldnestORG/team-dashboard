import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { campaignsApi } from "../api/campaigns";
import type { Campaign, CampaignContentItem } from "../api/campaigns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Megaphone,
  Plus,
  Calendar,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── Brand config ─────────────────────────────────────────────────────────────

const BRANDS = [
  { value: "all", label: "All" },
  { value: "cd", label: "CD" },
  { value: "tokns", label: "tokns" },
  { value: "shieldnest", label: "ShieldNest" },
  { value: "tx", label: "TX" },
  { value: "directory", label: "Directory" },
  { value: "partners", label: "Partners" },
] as const;

const PERSONALITIES = [
  "blaze",
  "cipher",
  "spark",
  "prism",
  "vanguard",
  "forge",
] as const;

// ── Status helpers ────────────────────────────────────────────────────────────

function statusChip(status: string) {
  switch (status) {
    case "active":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border text-[11px]">
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border text-[11px]">
          Paused
        </Badge>
      );
    case "complete":
      return (
        <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30 border text-[11px]">
          Complete
        </Badge>
      );
    default:
      return (
        <Badge className="bg-muted/50 text-muted-foreground border border-border text-[11px]">
          Draft
        </Badge>
      );
  }
}

function brandChip(brand: string) {
  const colors: Record<string, string> = {
    cd: "bg-coral-500/15 text-orange-400 border-orange-500/30",
    tokns: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    shieldnest: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    tx: "bg-lime-500/15 text-lime-400 border-lime-500/30",
    directory: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    partners: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  };
  return (
    <Badge
      className={`border text-[11px] uppercase tracking-wide ${
        colors[brand] ?? "bg-muted/50 text-muted-foreground border-border"
      }`}
    >
      {brand}
    </Badge>
  );
}

function fmtDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<CampaignContentItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  async function toggleExpand() {
    if (!expanded && items.length === 0) {
      setLoadingItems(true);
      try {
        const res = await campaignsApi.getContent(campaign.id);
        setItems(res.items);
      } catch {
        // ignore
      } finally {
        setLoadingItems(false);
      }
    }
    setExpanded((v) => !v);
  }

  return (
    <Card className="bg-card border border-border hover:border-border/80 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">
              {campaign.name}
            </CardTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              {brandChip(campaign.brand)}
              {statusChip(campaign.status)}
            </div>
          </div>
          <button
            onClick={toggleExpand}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col gap-2">
        {campaign.goal && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {campaign.goal}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {fmtDate(campaign.startDate)} – {fmtDate(campaign.endDate)}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {campaign.contentCount ?? 0} items
          </span>
        </div>

        {expanded && (
          <div className="mt-2 border-t border-border pt-2">
            {loadingItems ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading content…
              </div>
            ) : items.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No content items yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-b border-border/50 last:border-0"
                  >
                    <span className="truncate text-foreground/80">
                      {item.topic}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className="text-[10px] bg-muted/50 text-muted-foreground border border-border capitalize">
                        {item.platform}
                      </Badge>
                      <Badge className="text-[10px] bg-muted/50 text-muted-foreground border border-border capitalize">
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── New Campaign Dialog ───────────────────────────────────────────────────────

interface NewCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}

function NewCampaignDialog({ open, onClose, onCreated }: NewCampaignDialogProps) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState<string>("cd");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetSites, setTargetSites] = useState("");
  const [personalities, setPersonalities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setBrand("cd");
    setGoal("");
    setStartDate("");
    setEndDate("");
    setTargetSites("");
    setPersonalities([]);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function togglePersonality(p: string) {
    setPersonalities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sites = targetSites
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await campaignsApi.create({
        name: name.trim(),
        brand,
        goal: goal.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        targetSites: sites,
        personalityAllowlist: personalities,
      });
      onCreated(res.campaign);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q2 AEO Push"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Brand */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Brand</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {BRANDS.filter((b) => b.value !== "all").map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          {/* Goal */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Goal</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              placeholder="Drive 50 backlinks to directory.coherencedaddy.com via AEO content…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Target Sites */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Target Sites</label>
            <input
              type="text"
              value={targetSites}
              onChange={(e) => setTargetSites(e.target.value)}
              placeholder="coherencedaddy.com, directory.coherencedaddy.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">Comma-separated list</p>
          </div>

          {/* Personalities */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Personalities</label>
            <div className="flex flex-wrap gap-2">
              {PERSONALITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePersonality(p)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors capitalize ${
                    personalities.includes(p)
                      ? "bg-primary/20 text-primary border-primary/40"
                      : "bg-muted/40 text-muted-foreground border-border hover:border-border/80"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating…
                </>
              ) : (
                "Create Campaign"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MarketingPushes() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [brandTab, setBrandTab] = useState("all");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Marketing Pushes" }]);
  }, [setBreadcrumbs]);

  async function loadCampaigns() {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignsApi.list();
      setCampaigns(res.campaigns);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  const filtered =
    brandTab === "all"
      ? campaigns
      : campaigns.filter((c) => c.brand === brandTab);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Marketing Pushes</h1>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Campaign
        </Button>
      </div>

      {/* Brand Tabs */}
      <Tabs value={brandTab} onValueChange={setBrandTab}>
        <TabsList className="h-9">
          {BRANDS.map((b) => (
            <TabsTrigger key={b.value} value={b.value} className="text-xs">
              {b.label}
              {b.value !== "all" && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {campaigns.filter((c) => c.brand === b.value).length || ""}
                </span>
              )}
              {b.value === "all" && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {campaigns.length || ""}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {BRANDS.map((b) => (
          <TabsContent key={b.value} value={b.value} className="mt-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading campaigns…
              </div>
            ) : error ? (
              <div className="text-sm text-destructive py-4">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No campaigns yet.{" "}
                <button
                  onClick={() => setDialogOpen(true)}
                  className="underline hover:no-underline"
                >
                  Create one
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((campaign) => (
                  <CampaignCard key={campaign.id} campaign={campaign} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* New Campaign Dialog */}
      <NewCampaignDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(campaign) => {
          setCampaigns((prev) => [campaign, ...prev]);
        }}
      />
    </div>
  );
}
