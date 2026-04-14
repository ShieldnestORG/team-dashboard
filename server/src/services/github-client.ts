/**
 * Minimal GitHub REST API client for Sage's advisory PR drafting.
 *
 * Uses raw fetch — no octokit dep added. Scope is limited to the handful of
 * endpoints we need to: read default branch, create a new branch off it,
 * PUT a file onto that branch, and open a pull request.
 *
 * Auth: GITHUB_TOKEN env var (already set on the VPS).
 * Repo format: "owner/repo" (same format returned by repo-update-advisor's map).
 */

const GITHUB_API = "https://api.github.com";

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN not configured");
  return t;
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
  return { owner, name };
}

async function gh<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "team-dashboard-sage-advisor",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Never include the token or full body in the error — just the status +
    // GitHub's error message. Caller sanitizes further before returning to
    // clients.
    let msg = `GitHub ${method} ${path} failed: ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) msg += ` — ${errBody.message}`;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(msg);
  }
  // Some endpoints return empty body on success — guard against it.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function getDefaultBranch(repo: string): Promise<string> {
  const { owner, name } = parseRepo(repo);
  const data = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${name}`,
  );
  return data.default_branch;
}

export interface CreateBranchOptions {
  baseBranch: string;
  newBranchName: string;
}

export async function createBranch(
  repo: string,
  { baseBranch, newBranchName }: CreateBranchOptions,
): Promise<{ ref: string; sha: string }> {
  const { owner, name } = parseRepo(repo);
  // Get the base branch ref
  const baseRef = await gh<{ object: { sha: string } }>(
    "GET",
    `/repos/${owner}/${name}/git/ref/heads/${baseBranch}`,
  );
  // Create the new branch pointing at the base SHA
  const created = await gh<{ ref: string; object: { sha: string } }>(
    "POST",
    `/repos/${owner}/${name}/git/refs`,
    {
      ref: `refs/heads/${newBranchName}`,
      sha: baseRef.object.sha,
    },
  );
  return { ref: created.ref, sha: created.object.sha };
}

export interface UpdateFileOptions {
  branchName: string;
  filePath: string;
  content: string;
  commitMessage: string;
  authorName?: string;
  authorEmail?: string;
}

export async function updateFileOnBranch(
  repo: string,
  opts: UpdateFileOptions,
): Promise<{ commitSha: string }> {
  const { owner, name } = parseRepo(repo);
  const {
    branchName,
    filePath,
    content,
    commitMessage,
    authorName = "Sage (Advisory Bot)",
    authorEmail = "sage@coherencedaddy.com",
  } = opts;
  // Probe for existing file to get its blob sha (PUT contents requires it on
  // updates, but accepts missing sha on create).
  let sha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(
      "GET",
      `/repos/${owner}/${name}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branchName)}`,
    );
    sha = existing.sha;
  } catch {
    // 404 is fine — file doesn't exist yet, we'll create it.
  }
  const data = await gh<{ commit: { sha: string } }>(
    "PUT",
    `/repos/${owner}/${name}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
    {
      message: commitMessage,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch: branchName,
      ...(sha ? { sha } : {}),
      committer: { name: authorName, email: authorEmail },
      author: { name: authorName, email: authorEmail },
    },
  );
  return { commitSha: data.commit.sha };
}

export interface CreatePullRequestOptions {
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
}

export async function createPullRequest(
  repo: string,
  { headBranch, baseBranch, title, body }: CreatePullRequestOptions,
): Promise<{ number: number; url: string }> {
  const { owner, name } = parseRepo(repo);
  const data = await gh<{ number: number; html_url: string }>(
    "POST",
    `/repos/${owner}/${name}/pulls`,
    {
      title,
      body,
      head: headBranch,
      base: baseBranch,
    },
  );
  return { number: data.number, url: data.html_url };
}
