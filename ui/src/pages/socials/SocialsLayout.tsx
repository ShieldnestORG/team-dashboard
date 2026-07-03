import { useEffect, useState } from "react";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { useSearchParams } from "@/lib/router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FlowStepper } from "@/components/FlowStepper";
import { SocialsAccounts } from "./SocialsAccounts";
import { SocialsAutomation } from "./SocialsAutomation";
import { SocialsCalendar } from "./SocialsCalendar";
import { SocialsCompose } from "./SocialsCompose";
import { SocialsQueue } from "./SocialsQueue";
import { SocialsSchedule } from "./SocialsSchedule";

type Tab = "accounts" | "schedule" | "automation" | "calendar" | "compose" | "queue";
const TABS: Tab[] = ["accounts", "schedule", "automation", "calendar", "compose", "queue"];

export function SocialsLayout() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab: Tab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : "accounts";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setBreadcrumbs([{ label: "Socials" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Socials Hub</h1>
        <p className="text-sm text-muted-foreground">
          All social accounts, the automations driving them, the unified release calendar, and a queue-backed
          composer that drains via the socials relayer.
        </p>
      </div>
      <FlowStepper />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="w-full">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <SocialsAccounts />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <SocialsSchedule />
        </TabsContent>
        <TabsContent value="automation" className="mt-4">
          <SocialsAutomation />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <SocialsCalendar />
        </TabsContent>
        <TabsContent value="compose" className="mt-4">
          <SocialsCompose />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <SocialsQueue />
        </TabsContent>
      </Tabs>
    </div>
  );
}
