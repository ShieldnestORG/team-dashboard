import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Save, X } from "lucide-react";
import type { Partner, CreatePartnerInput } from "../api/partners";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INDUSTRIES = [
  "fitness", "dining", "wellness", "auto", "salon",
  "retail", "tech", "realestate", "education", "other",
] as const;

export const TIERS = ["proof", "partner", "premium"] as const;

export const STATUS_COLORS: Record<string, string> = {
  trial: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  paused: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  churned: "bg-red-500/20 text-red-400 border-red-500/30",
};

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

export interface PartnerFormState {
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
  // Phase 2
  address: string;
  phone: string;
  targetKeywords: string;
  targetAudience: string;
}

export const EMPTY_FORM: PartnerFormState = {
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
  address: "",
  phone: "",
  targetKeywords: "",
  targetAudience: "",
};

export function formFromPartner(p: Partner): PartnerFormState {
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
    address: p.address ?? "",
    phone: p.phone ?? "",
    targetKeywords: p.targetKeywords?.join(", ") ?? "",
    targetAudience: p.targetAudience ?? "",
  };
}

export function formToInput(f: PartnerFormState): CreatePartnerInput {
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
  if (f.address.trim()) input.address = f.address.trim();
  if (f.phone.trim()) input.phone = f.phone.trim();
  if (f.targetKeywords.trim()) input.targetKeywords = f.targetKeywords.split(",").map((s) => s.trim()).filter(Boolean);
  if (f.targetAudience.trim()) input.targetAudience = f.targetAudience.trim();
  return input;
}

// ---------------------------------------------------------------------------
// Form Component
// ---------------------------------------------------------------------------

export function PartnerForm({
  initial,
  onSave,
  onCancel,
  saving,
  variant = "card",
}: {
  initial: PartnerFormState;
  onSave: (form: PartnerFormState) => void;
  onCancel: () => void;
  saving: boolean;
  variant?: "card" | "inline";
}) {
  const [form, setForm] = useState<PartnerFormState>(initial);
  const set = (key: keyof PartnerFormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const fields = (
    <>
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

        {/* Phase 2 fields */}
        <div className="sm:col-span-2 pt-2 border-t">
          <span className="text-xs font-medium text-muted-foreground">Extended Profile</span>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Address</label>
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St, City, State" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Phone</label>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 123-4567" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Target Audience</label>
          <Input value={form.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} placeholder="Health-conscious professionals aged 25-45" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">SEO/AEO Target Keywords (comma-separated)</label>
          <Input value={form.targetKeywords} onChange={(e) => set("targetKeywords", e.target.value)} placeholder="personal training, fitness classes, gym near me" />
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
    </>
  );

  if (variant === "inline") {
    return <div className="space-y-4">{fields}</div>;
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-6 space-y-4">{fields}</CardContent>
    </Card>
  );
}
