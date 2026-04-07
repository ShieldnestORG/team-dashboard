import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { BookOpen, ChevronDown } from "lucide-react";

export interface HowToStep {
  title: string;
  description: string;
}

export interface HowToSection {
  heading: string;
  steps: HowToStep[];
}

interface HowToGuideProps {
  sections: HowToSection[];
}

export function HowToGuide({ sections }: HowToGuideProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="rounded-xl border-dashed border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between p-4 text-left hover:bg-blue-500/5 rounded-xl transition-colors">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium text-blue-400">
                How to use this page
              </span>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4 space-y-4">
            {sections.map((section, si) => (
              <div key={si}>
                <h3 className="text-sm font-semibold mb-2">{section.heading}</h3>
                <ol className="space-y-2 pl-1">
                  {section.steps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex-shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-blue-500/15 text-blue-400 text-xs font-bold">
                        {i + 1}
                      </span>
                      <div>
                        <span className="font-medium">{step.title}</span>
                        <span className="text-muted-foreground"> — {step.description}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
