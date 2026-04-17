import { useState } from "react";
import { useSearchParams } from "@/lib/router";
import { affiliatesApi } from "@/api/affiliates";

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

  // Render based on which flow we're in
  if (token) {
    // Set new password flow
    if (resetDone) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md px-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Password Updated</h1>
            <p className="text-gray-500 mb-6">Your password has been reset. You can now log in.</p>
            <a href="/" className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors">
              Back to Login
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 w-full max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Set a New Password</h1>
          <p className="text-sm text-gray-500 mb-6">Choose a strong password for your affiliate account.</p>
          <form onSubmit={handleReset} className="space-y-4">
            <input
              type="password" placeholder="New password (min 8 chars)"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <input
              type="password" placeholder="Confirm new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {resetError && <p className="text-sm text-red-500">{resetError}</p>}
            <button
              type="submit" disabled={resetLoading}
              className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {resetLoading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Forgot password flow
  if (forgotSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Check Your Email</h1>
          <p className="text-gray-500 mb-6">If an account exists for that address, we've sent a password reset link. Check your inbox.</p>
          <a href="/" className="text-sm text-amber-600 hover:text-amber-700">Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 w-full max-w-md">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-600 mb-6 block">← Back to login</a>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Forgot Password</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your affiliate email and we'll send a reset link.</p>
        <form onSubmit={handleForgot} className="space-y-4">
          <input
            type="email" placeholder="your@email.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {forgotError && <p className="text-sm text-red-500">{forgotError}</p>}
          <button
            type="submit" disabled={forgotLoading}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {forgotLoading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>
      </div>
    </div>
  );
}
