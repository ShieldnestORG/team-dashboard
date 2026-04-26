import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SocialsAccounts } from "./SocialsAccounts";
import { SocialsAutomation } from "./SocialsAutomation";
import { SocialsCalendar } from "./SocialsCalendar";

export function SocialsLayout() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<"accounts" | "automation" | "calendar">("accounts");

  useEffect(() => {
    setBreadcrumbs([{ label: "Socials" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Socials Hub</h1>
        <p className="text-sm text-muted-foreground">
          All social accounts, the automations driving them, and the unified release calendar.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="w-full">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <SocialsAccounts />
        </TabsContent>
        <TabsContent value="automation" className="mt-4">
          <SocialsAutomation />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <SocialsCalendar />
        </TabsContent>
      </Tabs>
    </div>
  );
}
