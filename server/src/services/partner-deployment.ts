// ---------------------------------------------------------------------------
// Partner Microsite Deployment Service
// ---------------------------------------------------------------------------
// Reads HTML/CSS templates, replaces placeholders with partner data,
// pushes to a GitHub repo, and optionally creates a Vercel project.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { partnerCompanies } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const GITHUB_ORG = "ShieldnestORG";
const GITHUB_API = "https://api.github.com";
const VERCEL_API = "https://api.vercel.com";

const BASE_APP_URL = "https://team-dashboard-cyan.vercel.app";

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

/** Project root (two levels above server/src/services/) */
function projectRoot(): string {
  // At runtime the CWD is typically the project root, but we resolve
  // relative to this file for safety.  __dirname equivalent for ESM:
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(thisDir, "..", "..", "..");
}

function templateDir(): string {
  return path.join(projectRoot(), "templates", "partner-microsite");
}

interface TemplateFile {
  relativePath: string;
  content: string;
}

function readTemplateFiles(): TemplateFile[] {
  const root = templateDir();
  const files: TemplateFile[] = [];

  function walk(dir: string, prefix: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        files.push({
          relativePath: rel,
          content: fs.readFileSync(path.join(dir, entry.name), "utf-8"),
        });
      }
    }
  }

  walk(root, "");
  return files;
}

function buildServicesHtml(services: string[]): string {
  if (!services || services.length === 0) return "";
  return services
    .map((s) => `<div class="service-card">${escapeHtml(s)}</div>`)
    .join("\n        ");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyPlaceholders(
  content: string,
  vars: Record<string, string>,
): string {
  let out = content;
  for (const [key, value] of Object.entries(vars)) {
    // Replace all occurrences of {{KEY}}
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is required");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function createGitHubRepo(repoName: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/orgs/${GITHUB_ORG}/repos`, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({
      name: repoName,
      private: false,
      auto_init: false,
      description: `Partner microsite — auto-deployed by Coherence Daddy`,
    }),
  });

  if (res.status === 422) {
    // Repo may already exist — try to fetch it
    const check = await fetch(
      `${GITHUB_API}/repos/${GITHUB_ORG}/${repoName}`,
      { headers: githubHeaders() },
    );
    if (check.ok) {
      const data = (await check.json()) as { html_url: string };
      logger.info(`GitHub repo already exists: ${data.html_url}`);
      return data.html_url;
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub create repo failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { html_url: string };
  logger.info(`Created GitHub repo: ${data.html_url}`);
  return data.html_url;
}

async function pushFileToRepo(
  repoName: string,
  filePath: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const url = `${GITHUB_API}/repos/${GITHUB_ORG}/${repoName}/contents/${filePath}`;

  // Check if file exists (to get its sha for update)
  let sha: string | undefined;
  const existing = await fetch(url, { headers: githubHeaders() });
  if (existing.ok) {
    const data = (await existing.json()) as { sha: string };
    sha = data.sha;
  }

  const body: Record<string, string> = {
    message: commitMessage,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub push ${filePath} failed (${res.status}): ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Vercel helpers
// ---------------------------------------------------------------------------

function vercelHeaders(): Record<string, string> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function createVercelProject(
  repoName: string,
  projectName: string,
): Promise<{ projectId: string; siteUrl: string }> {
  const res = await fetch(`${VERCEL_API}/v10/projects`, {
    method: "POST",
    headers: vercelHeaders(),
    body: JSON.stringify({
      name: projectName,
      framework: null,
      gitRepository: {
        type: "github",
        repo: `${GITHUB_ORG}/${repoName}`,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel create project failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string; name: string };
  const siteUrl = `https://${data.name}.vercel.app`;
  logger.info(`Created Vercel project: ${siteUrl}`);
  return { projectId: data.id, siteUrl };
}

// ---------------------------------------------------------------------------
// Main deploy function
// ---------------------------------------------------------------------------

export async function deployPartnerMicrosite(
  db: Db,
  partnerSlug: string,
): Promise<{ siteUrl: string; repoUrl: string }> {
  // 1. Fetch partner from DB
  const [partner] = await db
    .select()
    .from(partnerCompanies)
    .where(
      and(
        eq(partnerCompanies.companyId, COMPANY_ID),
        eq(partnerCompanies.slug, partnerSlug),
      ),
    )
    .limit(1);

  if (!partner) throw new Error(`Partner not found: ${partnerSlug}`);

  // Mark as building
  await db
    .update(partnerCompanies)
    .set({ siteDeployStatus: "building", updatedAt: new Date() })
    .where(eq(partnerCompanies.id, partner.id));

  try {
    // 2. Read template files
    const templates = readTemplateFiles();

    // 3. Build placeholder values
    const services = (partner.services as string[] | null) ?? [];
    const brandColors = partner.brandColors as
      | { primary?: string }
      | null
      | undefined;
    const primaryColor = brandColors?.primary ?? "#7c3aed";
    const ctaUrl = `${BASE_APP_URL}/api/go/${partner.slug}?src=microsite&utm_source=coherencedaddy&utm_medium=aeo&utm_campaign=partner`;
    const blogFeedUrl = `${BASE_APP_URL}/api/partner-sites/${partner.slug}/feed`;

    const vars: Record<string, string> = {
      PARTNER_NAME: partner.name,
      PARTNER_SLUG: partner.slug,
      LOCATION: partner.location ?? "",
      DESCRIPTION: partner.description ?? "",
      SERVICES_HTML: buildServicesHtml(services),
      CTA_URL: ctaUrl,
      BLOG_FEED_URL: blogFeedUrl,
      PRIMARY_COLOR: primaryColor,
      YEAR: new Date().getFullYear().toString(),
    };

    // 4. Render templates
    const rendered = templates.map((t) => ({
      relativePath: t.relativePath,
      content: applyPlaceholders(t.content, vars),
    }));

    // 5. Create GitHub repo
    const repoName = `partner-${partner.slug}`;
    const repoUrl = await createGitHubRepo(repoName);

    // 6. Push files to repo (sequentially to avoid race conditions)
    const commitMsg = `Initial partner microsite for ${partner.name}`;
    for (const file of rendered) {
      await pushFileToRepo(repoName, file.relativePath, file.content, commitMsg);
    }

    // 7. Optionally create Vercel project
    let siteUrl = repoUrl; // fallback: just the GitHub URL
    let vercelProjectId: string | null = null;

    if (process.env.VERCEL_TOKEN) {
      try {
        const vercel = await createVercelProject(
          repoName,
          `partner-${partner.slug}`,
        );
        siteUrl = vercel.siteUrl;
        vercelProjectId = vercel.projectId;
      } catch (err) {
        logger.warn(
          { err },
          "Vercel deployment failed — falling back to GitHub repo URL only",
        );
      }
    } else {
      logger.warn(
        "VERCEL_TOKEN not set — skipping Vercel deployment, returning GitHub repo URL",
      );
    }

    // 8. Update partner record
    await db
      .update(partnerCompanies)
      .set({
        siteUrl,
        siteRepoUrl: repoUrl,
        siteDeployStatus: "deployed",
        siteLastDeployedAt: new Date(),
        ...(vercelProjectId
          ? { siteVercelProjectId: vercelProjectId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(partnerCompanies.id, partner.id));

    logger.info(
      { slug: partner.slug, siteUrl, repoUrl },
      "Partner microsite deployed successfully",
    );

    return { siteUrl, repoUrl };
  } catch (err) {
    // Set failed status on any error
    await db
      .update(partnerCompanies)
      .set({ siteDeployStatus: "failed", updatedAt: new Date() })
      .where(eq(partnerCompanies.id, partner.id));

    logger.error(
      { err, slug: partnerSlug },
      "Partner microsite deployment failed",
    );
    throw err;
  }
}
