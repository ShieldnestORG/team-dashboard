import { useState } from "react";
import { useSearchParams } from "@/lib/router";
import { affiliatesApi } from "@/api/affiliates";
import {
  CDPage,
  LabelCaps,
  CDPrimaryButton,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO } from "@/lib/cdDesign";

const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "rgba(255,255,255,0.03)",
  border: `1px solid ${CD.border}`,
  borderRadius: 8,
  padding: "10px 12px",
  color: CD.ink,
  fontSize: "0.875rem",
  outline: "none",
  fontFamily: "inherit",
};

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  showBack = true,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  showBack?: boolean;
}) {
  return (
    <CDPage>
      <div className="flex items-center justify-center px-4 py-16" style={{ minHeight: "100dvh" }}>
        <div
          className="w-full max-w-md p-8"
          style={{
            backgroundColor: "rgba(255,255,255,0.025)",
            border: `1px solid ${CD.border}`,
            borderRadius: 16,
          }}
        >
          {showBack && (
            <a
              href="/"
              className="mb-6 block transition-colors"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.muted,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              ← Back to login
            </a>
          )}
          <LabelCaps color={CD.accent}>{eyebrow}</LabelCaps>
          <h1
            className="mt-3 text-2xl font-bold"
            style={{ letterSpacing: "-0.02em", color: CD.ink }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-sm" style={{ color: CD.muted }}>
              {subtitle}
            </p>
          )}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </CDPage>
  );
}

export function AffiliateResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  // Forgot password state
  const [email, setEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  // Reset password state
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError(null);
    try {
      await affiliatesApi.forgotPassword(email);
      setForgotSent(true);
    } catch {
      // Don't reveal whether email exists — show success anyway
      setForgotSent(true);
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setResetError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setResetError("Password must be at least 8 characters");
      return;
    }
    setResetLoading(true);
    setResetError(null);
    try {
      await affiliatesApi.resetPassword(token!, password);
      setResetDone(true);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetLoading(false);
    }
  }

  if (token) {
    if (resetDone) {
      return (
        <AuthShell
          eyebrow="Done"
          title="Password updated."
          subtitle="You can now log in with your new password."
          showBack={false}
        >
          <CDPrimaryButton
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            style={{ width: "100%" }}
          >
            Back to login
          </CDPrimaryButton>
        </AuthShell>
      );
    }
    return (
      <AuthShell
        eyebrow="Reset password"
        title="Set a new password."
        subtitle="Choose a strong password for your affiliate account."
      >
        <form onSubmit={handleReset} className="space-y-4">
          <input
            type="password"
            placeholder="New password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={inputStyle}
          />
          {resetError && (
            <p className="text-sm" style={{ color: CD.danger }}>{resetError}</p>
          )}
          <CDPrimaryButton type="submit" disabled={resetLoading} style={{ width: "100%" }}>
            {resetLoading ? "Updating…" : "Update password"}
          </CDPrimaryButton>
        </form>
      </AuthShell>
    );
  }

  // Forgot password flow
  if (forgotSent) {
    return (
      <AuthShell
        eyebrow="Check your inbox"
        title="Reset link sent."
        subtitle="If an account exists for that address, we've sent a password reset link."
      >
        <a
          href="/"
          style={{
            fontFamily: FONT_MONO,
            fontSize: "0.6875rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: CD.accent,
          }}
        >
          ← Back to login
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Forgot password"
      title="Reset your password."
      subtitle="Enter your affiliate email and we'll send a reset link."
    >
      <form onSubmit={handleForgot} className="space-y-4">
        <input
          type="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        {forgotError && (
          <p className="text-sm" style={{ color: CD.danger }}>{forgotError}</p>
        )}
        <CDPrimaryButton type="submit" disabled={forgotLoading} style={{ width: "100%" }}>
          {forgotLoading ? "Sending…" : "Send reset link"}
        </CDPrimaryButton>
      </form>
    </AuthShell>
  );
}
