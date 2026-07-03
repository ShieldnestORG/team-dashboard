import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface HelpTipProps {
  /** Accessible name for the trigger button, e.g. "What is the Queue tab?" */
  label: string;
  /** Plain-English help text (or any small block of content). */
  children: ReactNode;
  className?: string;
}

/**
 * Small "?" icon button that opens a popover with plain-English help text.
 * Drop next to any heading or tab label that could use one line of
 * non-technical explanation.
 */
export function HelpTip({ label, children, className }: HelpTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn("rounded-full text-muted-foreground hover:text-foreground", className)}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm text-muted-foreground" align="start">
        {children}
      </PopoverContent>
    </Popover>
  );
}
