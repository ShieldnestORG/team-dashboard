// Shared CD-design primitives used by the affiliate-facing surfaces.
// Keep this file thin — these are layout-level wrappers, not application widgets.
//
// All visual tokens come from @/lib/cdDesign. Editing colors here is a bug —
// edit the token file instead.

import type React from "react";
import {
  CD,
  FONT_SANS,
  FONT_MONO,
  PINSTRIPE,
  LABEL_CAPS_STYLE,
  useGeistFonts,
  LIFT_SHADOW,
  LIFT_SHADOW_HOVER,
} from "@/lib/cdDesign";

// ─────────────────────────────────────────────────────────────────────────────
// Page shell — dark canvas + pinstripe + Geist fonts loaded.
// Use this as the outer wrapper on every affiliate-facing page.
// ─────────────────────────────────────────────────────────────────────────────
export function CDPage({ children }: { children: React.ReactNode }) {
  useGeistFonts();
  return (
    <div
      style={{
        backgroundColor: CD.canvas,
        color: CD.ink,
        fontFamily: FONT_SANS,
        minHeight: "100dvh",
        backgroundImage: PINSTRIPE,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScanLines — brutalist-overlay texture for accent blocks.
// `position: absolute; inset: 0; pointer-events: none` — never affects layout.
// Use ONLY inside brutalist-accent blocks (hero stats, tier badges).
// Never on plain editorial surfaces (they already have Pinstripe).
// ─────────────────────────────────────────────────────────────────────────────
export function ScanLines({
  color = CD.ink,
  opacity = 0.14,
  spacing = 3,
}: {
  color?: string;
  opacity?: number;
  spacing?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        backgroundImage: `repeating-linear-gradient(0deg, transparent 0px, transparent ${
          spacing - 1
        }px, ${color} ${spacing - 1}px, ${color} ${spacing}px)`,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LabelCaps — mono uppercase tracked label.
// Used for section eyebrows, table column headers, status labels, metadata.
// ─────────────────────────────────────────────────────────────────────────────
export function LabelCaps({
  children,
  color,
  className,
  as: As = "span",
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
  as?: "span" | "p" | "div" | "th";
}) {
  return (
    <As
      className={className}
      style={{ ...LABEL_CAPS_STYLE, color: color ?? CD.muted }}
    >
      {children}
    </As>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mono — JetBrains/Geist Mono inline span. For numbers, IDs, timestamps.
// ─────────────────────────────────────────────────────────────────────────────
export function Mono({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{ fontFamily: FONT_MONO, fontVariantNumeric: "tabular-nums", ...style }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditorialCard — radius 16px, raised surface, hairline border.
// Default card for editorial surfaces (tables, prospect lists, prose sections).
// ─────────────────────────────────────────────────────────────────────────────
export function EditorialCard({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: "rgba(255,255,255,0.025)",
        border: `1px solid ${CD.border}`,
        borderRadius: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BrutalistCard — radius 0, 2px ink border, no shadow, ScanLines overlay.
// Reserved for high-agency marketing blocks: hero stat tiles, tier badges,
// conversion-rate cards. Never the whole page.
// ─────────────────────────────────────────────────────────────────────────────
export function BrutalistCard({
  children,
  fill,
  borderColor,
  className,
  showScanLines = true,
  scanLineColor,
  scanLineOpacity,
  style,
}: {
  children: React.ReactNode;
  fill?: string;
  borderColor?: string;
  className?: string;
  showScanLines?: boolean;
  scanLineColor?: string;
  scanLineOpacity?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        backgroundColor: fill ?? CD.surface,
        border: `2px solid ${borderColor ?? CD.ink}`,
        borderRadius: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      {showScanLines && (
        <ScanLines color={scanLineColor ?? CD.ink} opacity={scanLineOpacity ?? 0.10} />
      )}
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CDPrimaryButton — accent fill with neutral lift shadow.
// No coral glow — use LIFT_SHADOW only.
// ─────────────────────────────────────────────────────────────────────────────
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
};

export function CDPrimaryButton({ children, style, onMouseEnter, onMouseLeave, onMouseDown, onMouseUp, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        backgroundColor: CD.accent,
        color: CD.canvas,
        boxShadow: LIFT_SHADOW,
        borderRadius: 10,
        padding: "10px 20px",
        fontSize: "0.875rem",
        fontWeight: 600,
        border: "none",
        cursor: "pointer",
        transition:
          "box-shadow 260ms cubic-bezier(0.22,0.61,0.36,1), transform 260ms cubic-bezier(0.22,0.61,0.36,1), background-color 180ms",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = LIFT_SHADOW_HOVER;
        e.currentTarget.style.transform = "translateY(-2px)";
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = LIFT_SHADOW;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.backgroundColor = CD.accent;
        onMouseLeave?.(e);
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = CD.accentPressed;
        e.currentTarget.style.transform = "translateY(0)";
        onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.backgroundColor = CD.accent;
        onMouseUp?.(e);
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CDSecondaryButton — transparent fill, hairline border, paper ink text.
// ─────────────────────────────────────────────────────────────────────────────
export function CDSecondaryButton({ children, style, onMouseEnter, onMouseLeave, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        backgroundColor: "transparent",
        color: CD.ink,
        border: `1px solid ${CD.border}`,
        borderRadius: 10,
        padding: "10px 20px",
        fontSize: "0.875rem",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background-color 180ms, border-color 180ms",
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
        e.currentTarget.style.borderColor = CD.borderStrong;
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.borderColor = CD.border;
        onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade — subtle entrance reveal on mount.
// Honors prefers-reduced-motion.
// Animates only `transform` + `opacity` (DESIGN.md §6).
// ─────────────────────────────────────────────────────────────────────────────
export function Cascade({
  children,
  index = 0,
  className,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        animation: `cd-cascade-in 480ms cubic-bezier(0.22, 0.61, 0.36, 1) ${index * 60}ms both`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
