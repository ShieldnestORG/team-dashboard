import { Routes, Route } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { EcosystemBanner } from "./components/EcosystemBanner";
import { SchemaMarkup, websiteSchema } from "./components/SchemaMarkup";
import { HomePage } from "./pages/HomePage";
import { CompanyPage } from "./pages/CompanyPage";

function NotFound() {
  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-[var(--gold)] mb-4">404</h1>
      <p className="text-xl text-[var(--white)] mb-6">Page not found</p>
      <a
        href="/"
        className="px-6 py-3 rounded-lg bg-[var(--gold)] text-[var(--black)] font-semibold hover:bg-[var(--gold-light)] transition-colors"
      >
        Back to Directory
      </a>
    </main>
  );
}

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--black)]">
      <SchemaMarkup type="WebSite" data={websiteSchema()} />
      <Header />
      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/company/:slug" element={<CompanyPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      <EcosystemBanner />
      <Footer />
    </div>
  );
}
