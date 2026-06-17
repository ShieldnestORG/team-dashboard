import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Route-level ErrorBoundary
//
// Wraps the admin <Outlet /> so a render-time exception in one page does not
// blank the whole shell. Shows a minimal fallback card with a Reload action.
// Intentionally tiny — plugins/slots and plugins/launchers already have their
// own scoped boundaries; this one only catches what makes it through.
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught render error", error, info.componentStack);
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      const message = this.state.error?.message ?? "Unknown error";
      return (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1 space-y-2">
            <p className="font-medium text-destructive">Something went wrong on this page.</p>
            <p className="text-xs text-muted-foreground break-words">{message}</p>
            <Button size="sm" variant="outline" onClick={this.handleReload}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
