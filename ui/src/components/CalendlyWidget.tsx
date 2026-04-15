import { useEffect } from "react";

const CALENDLY_SCRIPT_URL = "https://assets.calendly.com/assets/external/widget.js";
const DEFAULT_CALENDLY_URL =
  "https://calendly.com/coherencedaddy-info?background_color=ff876d&primary_color=ff876d";

interface CalendlyWidgetProps {
  url?: string;
  height?: number;
  title?: string;
  subtitle?: string;
}

export function CalendlyWidget({
  url = DEFAULT_CALENDLY_URL,
  height = 700,
  title,
  subtitle,
}: CalendlyWidgetProps) {
  useEffect(() => {
    if (document.querySelector(`script[src="${CALENDLY_SCRIPT_URL}"]`)) return;
    const script = document.createElement("script");
    script.src = CALENDLY_SCRIPT_URL;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return (
    <div className="mt-6 rounded-xl border border-muted bg-muted/20 p-6">
      {(title || subtitle) && (
        <div className="mb-4 text-center">
          {title && <h2 className="text-2xl font-bold">{title}</h2>}
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      )}
      <div
        className="calendly-inline-widget"
        data-url={url}
        style={{ minWidth: "320px", height: `${height}px` }}
      />
    </div>
  );
}
