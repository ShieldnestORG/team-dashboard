// Fan a single-account operation out over N accounts, isolating failures so
// one bad account never loses the others. Used by SocialsCompose to post to
// multiple accounts in one submit without a bulk backend endpoint — see
// docs/products/socials-hub.md "Compose UX — multi-account + kit handoff".

export type SubmitResult<T> =
  | { accountId: string; ok: true; value: T }
  | { accountId: string; ok: false; error: string };

export async function submitToAccounts<T>(
  ids: string[],
  submitOne: (accountId: string) => Promise<T>,
): Promise<SubmitResult<T>[]> {
  const settled = await Promise.allSettled(ids.map((id) => submitOne(id)));
  return settled.map((r, i): SubmitResult<T> => {
    const accountId = ids[i]!;
    if (r.status === "fulfilled") {
      return { accountId, ok: true, value: r.value };
    }
    return { accountId, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
}
