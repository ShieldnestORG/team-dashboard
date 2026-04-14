import { useState } from "react";
import { intelBillingApi, type IntelUsageSummary } from "../api/intel-billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function IntelBillingSuccess() {
  const [rawKey, setRawKey] = useState("");
  const [summary, setSummary] = useState<IntelUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setError(null);
    setLoading(true);
    try {
      const res = await intelBillingApi.me(rawKey);
      setSummary(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Subscription confirmed</h1>
        <p className="mt-2 text-muted-foreground">
          Your API key has been sent to your email. Save it — it will only be shown once.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Verify your key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="text"
            placeholder="cd_intel_..."
            value={rawKey}
            onChange={(e) => setRawKey(e.target.value)}
          />
          <Button onClick={check} disabled={!rawKey || loading}>
            {loading ? "Checking…" : "Check usage"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {summary && (
            <div className="rounded border p-4 text-sm">
              <div>
                <strong>Email:</strong> {summary.email}
              </div>
              <div>
                <strong>Status:</strong> {summary.status}
              </div>
              <div>
                <strong>Plan:</strong> {summary.plan.name} ({summary.plan.slug})
              </div>
              <div>
                <strong>Quota:</strong> {summary.usage.requestCount.toLocaleString()} /{" "}
                {summary.plan.quota.toLocaleString()} requests this month
              </div>
              {summary.usage.overageCount > 0 && (
                <div>
                  <strong>Overage:</strong> {summary.usage.overageCount.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 rounded border p-4 text-sm">
        <p className="font-semibold">Quickstart</p>
        <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">
{`curl -H "Authorization: Bearer YOUR_KEY" \\
  https://api.coherencedaddy.com/api/intel/companies`}
        </pre>
      </div>
    </div>
  );
}
