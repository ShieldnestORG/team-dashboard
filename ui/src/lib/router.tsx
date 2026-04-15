import * as React from "react";
import * as RouterDom from "react-router-dom";
import type { NavigateOptions, To } from "react-router-dom";
import { useCompany } from "@/context/CompanyContext";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  normalizeCompanyPrefix,
} from "@/lib/company-routes";

function resolveTo(to: To, companyPrefix: string | null): To {
  if (typeof to === "string") {
    return applyCompanyPrefix(to, companyPrefix);
  }

  if (to.pathname && to.pathname.startsWith("/")) {
    const pathname = applyCompanyPrefix(to.pathname, companyPrefix);
    if (pathname !== to.pathname) {
      return { ...to, pathname };
    }
  }

  return to;
}

function useActiveCompanyPrefix(): string | null {
  const { selectedCompany, companies, loading: companiesLoading } = useCompany();
  const params = RouterDom.useParams<{ companyPrefix?: string }>();
  const location = RouterDom.useLocation();

  if (params.companyPrefix) {
    const normalizedParam = normalizeCompanyPrefix(params.companyPrefix);
    // Validate that this param is actually a real company prefix, not a board route
    // that got matched to /:companyPrefix because the real prefix was missing from the URL.
    // During initial load we can't validate yet, so we tentatively trust it.
    const isValidCompany =
      companiesLoading ||
      companies.some((c) => c.issuePrefix.toUpperCase() === normalizedParam);
    if (isValidCompany) {
      return normalizedParam;
    }
    // Not a known company prefix — the URL is missing the real company prefix.
    // Fall through to use selectedCompany so sidebar links don't inherit the bad value.
  }

  const pathPrefix = extractCompanyPrefixFromPath(location.pathname);
  if (pathPrefix) return pathPrefix;

  return selectedCompany ? normalizeCompanyPrefix(selectedCompany.issuePrefix) : null;
}

export * from "react-router-dom";

export const Link = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.Link>>(
  function CompanyLink({ to, ...props }, ref) {
    const companyPrefix = useActiveCompanyPrefix();
    return <RouterDom.Link ref={ref} to={resolveTo(to, companyPrefix)} {...props} />;
  },
);

export const NavLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<typeof RouterDom.NavLink>>(
  function CompanyNavLink({ to, ...props }, ref) {
    const companyPrefix = useActiveCompanyPrefix();
    return <RouterDom.NavLink ref={ref} to={resolveTo(to, companyPrefix)} {...props} />;
  },
);

export function Navigate({ to, ...props }: React.ComponentProps<typeof RouterDom.Navigate>) {
  const companyPrefix = useActiveCompanyPrefix();
  return <RouterDom.Navigate to={resolveTo(to, companyPrefix)} {...props} />;
}

export function useNavigate(): ReturnType<typeof RouterDom.useNavigate> {
  const navigate = RouterDom.useNavigate();
  const companyPrefix = useActiveCompanyPrefix();

  return React.useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigate(to);
        return;
      }
      navigate(resolveTo(to, companyPrefix), options);
    }) as ReturnType<typeof RouterDom.useNavigate>,
    [navigate, companyPrefix],
  );
}
