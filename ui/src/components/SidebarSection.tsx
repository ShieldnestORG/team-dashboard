import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  /** Optional Tailwind text-color class to color-code the section header by subject. */
  accentClassName?: string;
  children: ReactNode;
}

export function SidebarSection({ label, accentClassName, children }: SidebarSectionProps) {
  return (
    <div>
      <div
        className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest font-mono ${
          accentClassName ?? "text-muted-foreground/60"
        }`}
      >
        {label}
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
    </div>
  );
}
