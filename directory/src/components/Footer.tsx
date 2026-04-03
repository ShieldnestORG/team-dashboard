export function Footer() {
  return (
    <footer className="border-t border-[var(--muted)]/30 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Top row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
          <p className="text-sm text-[var(--slate)]">
            Powered by{" "}
            <a
              href="https://coherencedaddy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--gold)] hover:text-[var(--gold-light)] font-medium"
            >
              Coherence Daddy
            </a>
          </p>

          <div className="flex items-center gap-6">
            <a
              href="https://coherencedaddy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--slate)] hover:text-[var(--gold)] transition-colors"
            >
              coherencedaddy.com
            </a>
            <span className="text-[var(--muted)]">|</span>
            <a
              href="https://tokns.fi"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--slate)] hover:text-[var(--gold)] transition-colors"
            >
              tokns.fi
            </a>
            <span className="text-[var(--muted)]">|</span>
            <a
              href="https://shieldnest.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--slate)] hover:text-[var(--gold)] transition-colors"
            >
              shieldnest.org
            </a>
          </div>
        </div>

        {/* Bottom row */}
        <div className="text-center">
          <p className="text-xs text-[var(--muted)]">
            Data refreshed every 2-8 hours from 5 sources: news, prices,
            Twitter, GitHub, and Reddit
          </p>
        </div>
      </div>
    </footer>
  );
}
