// ---------------------------------------------------------------------------
// Partner Site Content Publisher
//
// Publishes draft blog posts to partner GitHub repos as static HTML pages.
// Uses GitHub Contents API to push files directly to the repo.
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies, partnerSiteContent } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/** Parse "owner/repo" from a GitHub URL like https://github.com/owner/repo */
function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // not a valid URL
  }
  return null;
}

/** GET a file from GitHub — returns { sha, content } or null if 404 */
async function getGitHubFile(
  owner: string,
  repo: string,
  path: string,
): Promise<{ sha: string; content: string } | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
    { headers: githubHeaders() },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { sha: string; content: string };
  return data;
}

/** PUT (create or update) a file in GitHub */
async function putGitHubFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<boolean> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: githubHeaders(),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, path, response: text.slice(0, 300) }, "GitHub PUT failed");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// HTML blog post template
// ---------------------------------------------------------------------------

function renderBlogPostHtml(opts: {
  title: string;
  metaDescription: string | null;
  body: string;
  partnerName: string;
  partnerSlug: string;
  publishedAt: string;
}): string {
  const dateStr = new Date(opts.publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const ctaUrl = `/api/go/${opts.partnerSlug}?src=microsite&utm_source=coherencedaddy&utm_medium=aeo&utm_campaign=partner`;
  const escapedTitle = opts.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedName = opts.partnerName.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapedDesc = (opts.metaDescription ?? "").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle} | ${escapedName}</title>
  <meta name="description" content="${escapedDesc}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">${escapedName}</a>
      <a href="/blog.html">Blog</a>
    </nav>
  </header>
  <main>
    <article>
      <h1>${escapedTitle}</h1>
      <time datetime="${opts.publishedAt}">${dateStr}</time>
      ${opts.body}
      <div class="cta">
        <a href="${ctaUrl}" class="cta-button">Visit ${escapedName}</a>
      </div>
    </article>
  </main>
  <footer>
    <p>Powered by <a href="https://coherencedaddy.com">Coherence Daddy</a></p>
  </footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Publish a single content item to partner's GitHub repo
// ---------------------------------------------------------------------------

export async function publishPartnerContent(
  db: Db,
  contentId: string,
): Promise<boolean> {
  // 1. Fetch the content record
  const [content] = await db
    .select()
    .from(partnerSiteContent)
    .where(eq(partnerSiteContent.id, contentId))
    .limit(1);

  if (!content) {
    logger.warn({ contentId }, "Partner content not found for publishing");
    return false;
  }

  // 2. Fetch the partner
  const [partner] = await db
    .select()
    .from(partnerCompanies)
    .where(eq(partnerCompanies.id, content.partnerId))
    .limit(1);

  if (!partner) {
    logger.warn({ contentId, partnerId: content.partnerId }, "Partner not found for content publishing");
    return false;
  }

  // 3. Check eligibility
  if (!partner.siteRepoUrl || partner.siteDeployStatus !== "deployed") {
    logger.info(
      { contentId, partnerSlug: partner.slug, siteDeployStatus: partner.siteDeployStatus },
      "Skipping publish — partner site not deployed",
    );
    return false;
  }

  const repoInfo = parseRepoUrl(partner.siteRepoUrl);
  if (!repoInfo) {
    logger.error({ contentId, siteRepoUrl: partner.siteRepoUrl }, "Invalid siteRepoUrl");
    return false;
  }

  // 4. Render HTML
  const html = renderBlogPostHtml({
    title: content.title,
    metaDescription: content.metaDescription,
    body: content.body,
    partnerName: partner.name,
    partnerSlug: partner.slug,
    publishedAt: new Date().toISOString(),
  });

  // 5. Push to GitHub
  const filePath = `blog/${content.slug}.html`;
  const existing = await getGitHubFile(repoInfo.owner, repoInfo.repo, filePath);

  const commitMsg = existing
    ? `Update blog post: ${content.title}`
    : `Add blog post: ${content.title}`;

  const pushed = await putGitHubFile(
    repoInfo.owner,
    repoInfo.repo,
    filePath,
    html,
    commitMsg,
    existing?.sha,
  );

  if (!pushed) {
    logger.error({ contentId, filePath }, "Failed to push blog post to GitHub");
    return false;
  }

  // 6. Update DB — mark as published
  const siteUrl = partner.siteUrl ?? `https://${partner.slug}.coherencedaddy.com`;
  const publishedUrl = `${siteUrl}/blog/${content.slug}.html`;

  await db
    .update(partnerSiteContent)
    .set({
      status: "published",
      publishedAt: new Date(),
      publishedUrl,
      updatedAt: new Date(),
    })
    .where(eq(partnerSiteContent.id, contentId));

  logger.info(
    { contentId, partnerSlug: partner.slug, publishedUrl, filePath },
    "Published partner content to GitHub",
  );

  return true;
}

// ---------------------------------------------------------------------------
// Publish all eligible draft content
// ---------------------------------------------------------------------------

export async function publishAllDraftContent(db: Db): Promise<number> {
  // Query drafts with deployed partners
  const drafts = await db
    .select({
      contentId: partnerSiteContent.id,
      partnerId: partnerSiteContent.partnerId,
    })
    .from(partnerSiteContent)
    .innerJoin(partnerCompanies, eq(partnerSiteContent.partnerId, partnerCompanies.id))
    .where(
      and(
        eq(partnerSiteContent.status, "draft"),
        eq(partnerCompanies.siteDeployStatus, "deployed"),
      ),
    );

  let published = 0;
  for (const draft of drafts) {
    try {
      const success = await publishPartnerContent(db, draft.contentId);
      if (success) published++;
    } catch (err) {
      logger.error({ err, contentId: draft.contentId }, "Error publishing partner content");
    }
  }

  logger.info({ published, total: drafts.length }, "Partner content publish cycle complete");
  return published;
}
