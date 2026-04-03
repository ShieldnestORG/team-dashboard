import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";

export function Header() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b border-[var(--muted)]/30 bg-[var(--black)]/95 backdrop-blur-sm sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <span className="text-xl font-bold text-[var(--heading-white)] group-hover:text-white transition-colors">
            Coherence Daddy
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/30">
            Directory
          </span>
        </Link>

        {/* Tagline - hidden on mobile */}
        <p className="hidden lg:block text-sm text-[var(--slate)] italic">
          Real-time blockchain intelligence
        </p>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link
            to="/"
            className="text-sm font-medium text-[var(--white)] hover:text-[var(--gold)] transition-colors"
          >
            Home
          </Link>
          <button
            onClick={() => {
              navigate("/");
              setTimeout(() => {
                document.getElementById("directory-search")?.focus();
              }, 100);
            }}
            className="text-sm font-medium text-[var(--white)] hover:text-[var(--gold)] transition-colors cursor-pointer bg-transparent border-none"
          >
            Search
          </button>
          <a
            href="https://coherencedaddy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--slate)] hover:text-[var(--gold)] transition-colors"
          >
            coherencedaddy.com &rarr;
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 text-[var(--white)] hover:text-[var(--gold)] transition-colors"
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {mobileOpen ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </>
            ) : (
              <>
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </>
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--muted)]/30 px-4 py-4 space-y-3 bg-[var(--black)]">
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            className="block text-sm font-medium text-[var(--white)] hover:text-[var(--gold)]"
          >
            Home
          </Link>
          <button
            onClick={() => {
              setMobileOpen(false);
              navigate("/");
              setTimeout(() => {
                document.getElementById("directory-search")?.focus();
              }, 100);
            }}
            className="block text-sm font-medium text-[var(--white)] hover:text-[var(--gold)] bg-transparent border-none cursor-pointer p-0"
          >
            Search
          </button>
          <a
            href="https://coherencedaddy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-medium text-[var(--slate)] hover:text-[var(--gold)]"
          >
            coherencedaddy.com &rarr;
          </a>
        </div>
      )}
    </header>
  );
}
