import { MousePointerClick, BarChart2, FileText, ArrowRight, CheckCircle } from "lucide-react";

const BENEFITS = [
  {
    icon: MousePointerClick,
    title: "Real Traffic, Tracked",
    body: "Every click we drive to your business is logged and timestamped. No guessing — you see exactly what's coming your way.",
  },
  {
    icon: FileText,
    title: "Your Business in Our Content",
    body: "Our AI content engine naturally mentions partner businesses across blog posts, social threads, and articles that reach thousands of readers.",
  },
  {
    icon: BarChart2,
    title: "Live Performance Dashboard",
    body: "Log in anytime with your access token to see clicks, content mentions, traffic trends, and how your partnership is performing.",
  },
];

const TIERS = [
  {
    name: "Proof",
    price: "$49",
    description: "See what we can do before committing.",
    features: ["30-day trial run", "Content mentions", "Click tracking", "Partner dashboard access"],
    cta: "Get Started",
    highlight: false,
  },
  {
    name: "Performance",
    price: "$149",
    description: "Full content integration + priority placement.",
    features: ["Everything in Proof", "Priority content mentions", "Social media features", "Monthly performance report"],
    cta: "Most Popular",
    highlight: true,
  },
  {
    name: "Premium",
    price: "$499",
    description: "Dedicated content strategy for your business.",
    features: ["Everything in Performance", "Dedicated content strategy", "Custom landing page", "Direct support line"],
    cta: "Go Premium",
    highlight: false,
  },
];

export function PartnersLanding() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="https://coherencedaddy.com" className="flex items-center gap-2">
            <span className="font-bold text-gray-900 text-lg">Coherence Daddy</span>
            <span className="text-gray-400 text-sm">/ Partners</span>
          </a>
          <span className="text-sm text-gray-400">
            Use the dashboard link we sent you to log in
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-700 text-xs font-semibold px-3 py-1 rounded-full mb-6">
          AEO Partner Network
        </div>
        <h1 className="text-5xl font-extrabold text-gray-900 leading-tight mb-6">
          Grow Your Business with<br />
          <span className="text-violet-600">AI-Driven Content</span>
        </h1>
        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10">
          We weave your business into content that reaches thousands. Track every click, every mention, every result — in real time.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="https://coherencedaddy.com"
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            Become a Partner
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="https://coherencedaddy.com"
            className="inline-flex items-center gap-2 border border-gray-200 hover:border-violet-300 text-gray-700 hover:text-violet-700 font-medium px-6 py-3 rounded-lg transition-colors"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-gray-50 border-y border-gray-100 py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-12">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {BENEFITS.map((b) => (
              <div key={b.title} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center mb-4">
                  <b.icon className="w-5 h-5 text-violet-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-4">
          Simple, Performance-Based Pricing
        </h2>
        <p className="text-center text-gray-500 mb-12">
          Start free, pay as results come in. No lock-in.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-xl border p-6 flex flex-col ${
                tier.highlight
                  ? "border-violet-500 bg-violet-50 shadow-md"
                  : "border-gray-200 bg-white shadow-sm"
              }`}
            >
              {tier.highlight && (
                <div className="text-xs font-bold text-violet-600 uppercase tracking-wide mb-2">
                  Most Popular
                </div>
              )}
              <div className="text-lg font-bold text-gray-900">{tier.name}</div>
              <div className="text-3xl font-extrabold text-gray-900 mt-1 mb-1">
                {tier.price}
                <span className="text-sm font-normal text-gray-400">/mo</span>
              </div>
              <p className="text-sm text-gray-500 mb-6">{tier.description}</p>
              <ul className="space-y-2 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="https://coherencedaddy.com"
                className={`mt-6 inline-flex items-center justify-center gap-2 font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors ${
                  tier.highlight
                    ? "bg-violet-600 hover:bg-violet-700 text-white"
                    : "border border-gray-200 hover:border-violet-300 text-gray-700 hover:text-violet-700"
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section className="bg-violet-600 py-14">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-extrabold text-white mb-4">
            Already a partner?
          </h2>
          <p className="text-violet-200 mb-4">
            Use the dashboard link we sent you to view your traffic, mentions, and performance.
          </p>
          <p className="text-violet-300 text-sm">
            Don't have a link? Contact us at{" "}
            <a href="https://coherencedaddy.com" className="underline hover:text-white transition-colors">
              coherencedaddy.com
            </a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span>© 2026 Coherence Daddy / ShieldNest. All rights reserved.</span>
          <a href="https://coherencedaddy.com" className="hover:text-violet-600 transition-colors">
            coherencedaddy.com
          </a>
        </div>
      </footer>
    </div>
  );
}
