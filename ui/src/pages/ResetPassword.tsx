import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { Sparkles } from "lucide-react";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authApi.resetPassword({ newPassword: password, token: token! }),
    onSuccess: () => {
      setError(null);
      navigate("/auth", { replace: true });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    },
  });

  const canSubmit = password.trim().length >= 8 && confirm.trim().length > 0;

  return (
    <div className="fixed inset-0 flex bg-background">
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="flex items-center gap-2 mb-8">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Team Dashboard</span>
          </div>

          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a new password for your account.
          </p>

          {!token ? (
            <div className="mt-6 space-y-4">
              <p className="text-sm text-destructive">
                This reset link is missing or invalid. Request a new one from the sign-in page.
              </p>
              <button
                type="button"
                className="text-sm font-medium text-foreground underline underline-offset-2"
                onClick={() => navigate("/auth", { replace: true })}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (mutation.isPending) return;
                if (password.trim().length < 8) {
                  setError("Password must be at least 8 characters.");
                  return;
                }
                if (password !== confirm) {
                  setError("Passwords do not match.");
                  return;
                }
                mutation.mutate();
              }}
            >
              <div>
                <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">New password</label>
                <input
                  id="password"
                  name="password"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="confirm" className="text-xs text-muted-foreground mb-1 block">Confirm new password</label>
                <input
                  id="confirm"
                  name="confirm"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                type="submit"
                disabled={mutation.isPending}
                aria-disabled={!canSubmit || mutation.isPending}
                className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
              >
                {mutation.isPending ? "Working…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </div>
  );
}
