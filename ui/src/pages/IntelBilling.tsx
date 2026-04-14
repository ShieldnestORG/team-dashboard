import { useQuery } from "@tanstack/react-query";
import { intelBillingApi } from "../api/intel-billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function IntelBilling() {
  const { data, isLoading } = useQuery({
    queryKey: ["intel-billing", "customers"],
    queryFn: () => intelBillingApi.listCustomers(),
  });

  if (isLoading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }
  const rows = data?.customers ?? [];
  const mrr = ((data?.mrrCents ?? 0) / 100).toFixed(0);

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Intel Billing</h1>
        <p className="mt-1 text-muted-foreground">Paid Intel API customers</p>
      </header>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">MRR</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">${mrr}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Customers</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">
            {rows.filter((r) => r.status === "active").length}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscribers</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Email</th>
                <th className="py-2">Plan</th>
                <th className="py-2">Status</th>
                <th className="py-2">Renews</th>
                <th className="py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 font-mono text-xs">{r.email}</td>
                  <td className="py-2">{r.planName ?? "—"}</td>
                  <td className="py-2">
                    <Badge variant={r.status === "active" ? "default" : "secondary"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-xs">
                    {r.currentPeriodEnd
                      ? new Date(r.currentPeriodEnd).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="py-2 text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No customers yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
