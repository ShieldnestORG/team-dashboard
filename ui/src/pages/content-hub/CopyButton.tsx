import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  /**
   * Copied byte-exact via navigator.clipboard.writeText — emoji, accents and
   * curly quotes survive intact (this is why kits render from the md-synced
   * module, never the board HTML).
   */
  text: string;
  label: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm";
  className?: string;
}

export function CopyButton({ text, label, variant = "outline", size = "sm", className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 1500);
  }, [text]);

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={handleClick}>
      {state === "copied" ? (
        <Check className="h-4 w-4" />
      ) : state === "failed" ? (
        <X className="h-4 w-4" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}
