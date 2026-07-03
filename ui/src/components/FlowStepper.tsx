import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

export type FlowStepKey = "create" | "review" | "queue" | "posted";

interface FlowStep {
  key: FlowStepKey;
  label: string;
  href: string;
  description: string;
}

interface FlowStepperProps {
  /** Highlights the step you're currently on. Omit if the page spans several steps. */
  current?: FlowStepKey;
  /** Override where "Create" links to — Content Hub vs. ContentReview both count. */
  createHref?: string;
  className?: string;
}

/**
 * Plain-English map of the content pipeline: Create -> Review -> Queue -> Posted.
 * Every step is a link so anyone can jump straight to that stage. Placed at the
 * top of Content Hub, ContentReview, and the Socials overview.
 */
export function FlowStepper({ current, createHref = "/socials/content", className }: FlowStepperProps) {
  const steps: FlowStep[] = [
    {
      key: "create",
      label: "Create",
      href: createHref,
      description:
        "Write it yourself in Compose, generate it with AI in the Content tab, or grab a kit from Content Hub.",
    },
    {
      key: "review",
      label: "Review",
      href: "/socials/content",
      description: "AI drafts land here for a quick read before they're allowed to queue.",
    },
    {
      key: "queue",
      label: "Queue",
      href: "/socials?tab=queue",
      description: "Everything scheduled to go out. Posts leave automatically — nobody needs to hit post.",
    },
    {
      key: "posted",
      label: "Posted",
      href: "/socials/analytics",
      description: "Once it's live, results show up in Analytics.",
    },
  ];

  return (
    <div className={cn("rounded-lg border border-border bg-muted/20 p-3", className)}>
      <div className="flex flex-wrap items-start gap-x-1 gap-y-3">
        {steps.map((step, i) => (
          <div key={step.key} className="flex items-start">
            <Link
              to={step.href}
              className={cn(
                "flex max-w-[13rem] flex-col gap-1 rounded-md px-2 py-1 transition-colors hover:bg-muted/60",
                current === step.key && "bg-muted/60",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    current === step.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted-foreground/15 text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                {step.label}
              </span>
              <span className="text-xs text-muted-foreground">{step.description}</span>
            </Link>
            {i < steps.length - 1 && (
              <span className="mx-1 mt-1.5 text-muted-foreground/40" aria-hidden="true">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
