import * as React from "react";
import * as RouterDom from "react-router-dom";
import type { NavigateOptions, To } from "react-router-dom";
import { useCompany } from "@/context/CompanyContext";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  normalizeCompanyPrefix,
} from "@/lib/company-routes";

function resolveTo(to: To, companyPrefix: string | null, knownCompanyPrefixes: readonly string[]): To {
  if (typeof to === "string") {
    return applyCompanyPrefix(to, companyPrefix, knownCompanyPrefixes);
  }

  if (to.pathname && to.pathname.startsWith("/")) {
    const pathname = applyCompanyPrefix(to.pathname, companyPrefix, knownCompanyPrefixes);
    if (pathname !== to.pathname) {
      return { ...to, pathname };
    }
  }

  return to;
}

interface ActiveCompanyRouting {
  companyPrefix: string | null;
  /** Real company issuePrefixes; empty while companies are still loading. */
  knownCompanyPrefixes: readonly string[];
}

function useActiveCompanyRouting(): ActiveCompanyRouting {
  const { selectedCompany, companies, loading: companiesLoading } = useCompany();
  const params = RouterDom.useParams<{ companyPrefix?: string }>();
  const location = RouterDom.useLocation();
  const knownCompanyPrefixes = React.useMemo(
    () => companies.map((company) => company.issuePrefix),
    [companies],
  );

  if (params.companyPrefix) {
    const normalizedParam = normalizeCompanyPrefix(params.companyPrefix);
    // Validate that this param is actually a real company prefix, not a board route
    // that got matched to /:companyPrefix because the real prefix was missing from the URL.
    // During initial load we can't validate yet, so we tentatively trust it.
    const isValidCompany =
      companiesLoading ||
      companies.some((c) => c.issuePrefix.toUpperCase() === normalizedParam);
    if (isValidCompany) {
      return { companyPrefix: normalizedParam, knownCompanyPrefixes };
    }
    // Not a known company prefix — the URL is missing the real company prefix.
    // Fall through to use selectedCompany so sidebar links don't inherit the bad value.
  }

  const pathPrefix = extractCompanyPrefixFromPath(location.pathname, knownCompanyPrefixes);
  if (pathPrefix) return { companyPrefix: pathPrefix, knownCompanyPrefixes };

  return {
    companyPrefix: selectedCompany ? normalizeCompanyPrefix(selectedCompany.issuePrefix) : null,
    knownCompanyPrefixes,
  };
}

export * from "react-router-dom";

export const Link = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.Link>>(
  function CompanyLink({ to, ...props }, ref) {
    const { companyPrefix, knownCompanyPrefixes } = useActiveCompanyRouting();
    return <RouterDom.Link ref={ref} to={resolveTo(to, companyPrefix, knownCompanyPrefixes)} {...props} />;
  },
);

export const NavLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.NavLink>>(
  function CompanyNavLink({ to, ...props }, ref) {
    const { companyPrefix, knownCompanyPrefixes } = useActiveCompanyRouting();
    return <RouterDom.NavLink ref={ref} to={resolveTo(to, companyPrefix, knownCompanyPrefixes)} {...props} />;
  },
);

export function Navigate({ to, ...props }: React.ComponentProps<typeof RouterDom.Navigate>) {
  const { companyPrefix, knownCompanyPrefixes } = useActiveCompanyRouting();
  return <RouterDom.Navigate to={resolveTo(to, companyPrefix, knownCompanyPrefixes)} {...props} />;
}

export function useNavigate(): ReturnType<typeof RouterDom.useNavigate> {
  const navigate = RouterDom.useNavigate();
  const { companyPrefix, knownCompanyPrefixes } = useActiveCompanyRouting();

  return React.useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveTo(to, companyPrefix, knownCompanyPrefixes), options);
    }) as ReturnType<typeof RouterDom.useNavigate>,
    [navigate, companyPrefix, knownCompanyPrefixes],
  );
}
