import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSidebar } from "../context/SidebarContext";
import { cn } from "../lib/utils";

export interface PageTabItem {
  value: string;
  label: ReactNode;
}

interface PageTabBarProps {
  items: PageTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
  align?: "center" | "start";
}

export function PageTabBar({ items, value, onValueChange, align = "center" }: PageTabBarProps) {
  const { isMobile } = useSidebar();

  if (isMobile && value !== undefined && onValueChange) {
    return (
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2 py-1 text-base focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {typeof item.label === "string" ? item.label : item.value}
          </option>
        ))}
      </select>
    );
  }

  return (
    // A long row wraps onto a second line instead of making the page scroll sideways: the ten
    // Socials tabs are 1,150 px wide and pushed <main> 158 px sideways at a 1280 px window (2026-10-09).
    <TabsList
      variant="line"
      className={cn(
        "max-w-full flex-wrap gap-y-1 group-data-[orientation=horizontal]/tabs:h-auto",
        align === "start" && "justify-start",
      )}
    >
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value} className="flex-none">
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
