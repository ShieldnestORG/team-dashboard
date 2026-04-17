import { useState } from "react";
import { HandCoins, BarChart2, DollarSign } from "lucide-react";
import { affiliatesApi, setAffiliateToken } from "@/api/affiliates";

const BENEFITS = [
  {
    icon: HandCoins,
    title: "Simple Referral",
    body: "Enter any business website. We scrape, analyze, and build a full profile automatically. You bring the lead, we do the work.",
  },
  {
    icon: BarChart2,
    title: "Track Every Prospect",
    body: "See your submitted clients, their onboarding status, competitor analysis, and all the intel we build for them.",
  },
  {
    icon: DollarSign,
    title: "Earn Commission",
    body: "Get a percentage of every monthly subscription from clients you bring in. The more they grow, the more you earn.",
  },
];

export function AffiliateLanding() {
  const [authTab, setAuthTab] = useState<"login" | "register">("login");

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Register state
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await affiliatesApi.login({ email: loginEmail, password: loginPassword });
      setAffiliateToken(res.token);
      window.location.href = "/dashboard";
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegLoading(true);
    setRegError(null);
    try {
      await affiliatesApi.register({ name: regName, email: regEmail, password: regPassword });
      setRegSuccess(true);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="https://coherencedaddy.com" className="flex items-center gap-2">
            <span className="font-bold text-gray-900 text-lg">Coherence Daddy</span>
            <span className="text-gray-400 text-sm">/ Affiliates</span>
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full mb-6">
          Affiliate Program
        </div>
        <h1 className="text-5xl font-extrabold text-gray-900 leading-tight mb-6">
          Earn Commission Bringing Clients<br />
          <span className="text-amber-600">to Coherence Daddy</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          Visit local businesses, share your referral, and earn every time a client subscribes.
          Real impact, real earnings.
        </p>
      </section>

      {/* Benefits */}
      <section className="bg-gray-50 border-y border-gray-100 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {BENEFITS.map((b) => (
              <div key={b.title} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-4">
                  <b.icon className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Auth Section */}
      <section className="max-w-5xl mx-auto px-6 py-16 flex flex-col items-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">Get Started</h2>
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Toggle */}
          <div className="flex border-b border-gray-100">
            <button
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                authTab === "login"
                  ? "bg-amber-50 text-amber-700 border-b-2 border-amber-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setAuthTab("login")}
            >
              Log In
            </button>
            <button
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                authTab === "register"
                  ? "bg-amber-50 text-amber-700 border-b-2 border-amber-500"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              onClick={() => setAuthTab("register")}
            >
              Create Account
            </button>
          </div>

          <div className="p-6">
            {authTab === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loginLoading ? "Logging in..." : "Log In"}
                </button>
                {loginError && (
                  <p className="text-xs text-red-500 text-center">{loginError}</p>
                )}
              </form>
            ) : regSuccess ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
                <p className="text-sm font-medium text-gray-900 mb-1">Application submitted!</p>
                <p className="text-sm text-gray-500">
                  We'll review your account and notify you once approved.
                </p>
              </div>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {regLoading ? "Creating account..." : "Create Account"}
                </button>
                {regError && (
                  <p className="text-xs text-red-500 text-center">{regError}</p>
                )}
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center text-sm text-gray-400">
          Coherence Daddy Affiliate Program · Built on the world's most complete local business intelligence network.
        </div>
      </footer>
    </div>
  );
}
