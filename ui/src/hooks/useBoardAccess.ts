import { useQuery } from "@tanstack/react-query";
import { accessApi, type BoardAccessSnapshot } from "../api/access";

/**
 * Is this a marketing-only user? True when the snapshot belongs to a real
 * (non-instance-admin) board user whose EVERY membership carries the
 * 'marketing' role. Mirrors the server's marketing-role-gate semantics —
 * but the UI filtering built on this is cosmetic; the middleware is the
 * real enforcement.
 */
export function isMarketingOnlyAccess(access: BoardAccessSnapshot | null | undefined): boolean {
  if (!access) return false;
  if (access.isInstanceAdmin) return false;
  return (
    access.memberships.length > 0 &&
    access.memberships.every((membership) => membership.role === "marketing")
  );
}

/**
 * Board identity + membership roles from GET /cli-auth/me (CONTRACT-4).
 * Returns 401 for non-board sessions; any failure is treated as "no access
 * info" so admin-only affordances stay hidden and role filters stay off.
 */
export function useBoardAccess() {
  const query = useQuery({
    queryKey: ["board-access"],
    queryFn: () => accessApi.getBoardAccess(),
    retry: false,
    staleTime: 60_000,
  });

  const access = query.data ?? null;
  return {
    access,
    isLoading: query.isLoading,
    isInstanceAdmin: access?.isInstanceAdmin ?? false,
    isMarketingOnly: isMarketingOnlyAccess(access),
  };
}
