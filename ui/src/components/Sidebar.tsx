import { Inbox, LayoutDashboard, Search, SquarePen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { useBoardAccess } from "../hooks/useBoardAccess";
import { filterSectionsForMarketing, getSidebarConfig } from "../config/company-sidebars";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";

export function Sidebar() {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();

  // Marketing-role users see only their working sections. The section filter
  // is cosmetic (the server's marketing-role gate is the real enforcement),
  // but skipping the badge/live-run polling below is functional: those reads
  // are gate-blocked and would only ever 403. While the access snapshot is
  // still loading we hold the polling off too, so a marketing user's first
  // paint never fires doomed requests.
  const { isMarketingOnly, isLoading: accessLoading } = useBoardAccess();
  const showFullShell = !accessLoading && !isMarketingOnly;

  const inboxBadge = useInboxBadge(showFullShell ? selectedCompanyId : null);
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId && showFullShell,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  const allSections = getSidebarConfig(selectedCompany?.issuePrefix ?? "");
  const sections = isMarketingOnly ? filterSectionsForMarketing(allSections) : allSections;

  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: Company name (bold) + Search — aligned with top sections (no visible border) */}
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        {selectedCompany?.brandColor && (
          <div
            className="w-4 h-4 rounded-sm shrink-0 ml-1"
            style={{ backgroundColor: selectedCompany.brandColor }}
          />
        )}
        <span className="flex-1 text-sm font-bold text-foreground truncate pl-1">
          {selectedCompany?.name ?? "Select company"}
        </span>
        {/* Search reaches issue queries the marketing gate blocks — hide it
            rather than show an affordance that can only end in a 403. */}
        {!isMarketingOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0"
            onClick={openSearch}
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {/* Dashboard / Inbox / New Issue reach APIs the marketing gate
              blocks (issues POST, dashboard summary, approvals) — a marketing
              user gets the Content & Socials section below instead. */}
          {!isMarketingOnly && (
            <>
              {/* New Issue button aligned with nav items */}
              <button
                onClick={() => openNewIssue()}
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                <SquarePen className="h-4 w-4 shrink-0" />
                <span className="truncate">New Issue</span>
              </button>
              <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
              <SidebarNavItem
                to="/inbox"
                label="Inbox"
                icon={Inbox}
                badge={inboxBadge.inbox}
                badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
                alert={inboxBadge.failedRuns > 0}
              />
            </>
          )}
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />
        </div>

        {sections.map((section, index) => {
          if (section.kind === "projects") return <SidebarProjects key={`projects-${index}`} />;
          if (section.kind === "agents") return <SidebarAgents key={`agents-${index}`} />;
          return (
            <SidebarSection
              key={section.label}
              label={section.label}
              accentClassName={section.accentClassName}
            >
              {section.items.map((item) => (
                <SidebarNavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  textBadge={item.textBadge}
                  textBadgeTone={item.textBadgeTone}
                />
              ))}
            </SidebarSection>
          );
        })}

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
