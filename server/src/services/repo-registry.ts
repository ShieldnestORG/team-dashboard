/**
 * Repo Registry — static catalog of every repository in the Coherence Daddy
 * ecosystem, with control-plane coupling metadata.
 *
 * Mirrors the const-module pattern of `api-registry.ts`: there is NO DB table.
 * This module is the single source of truth, read by the control-plane route
 * (`routes/control-plane.ts`) and surfaced in the admin UI.
 *
 * The remote / branch / localPath fields below were captured FACTUALLY from
 * the live working copies under /Users/exe/Downloads/Claude on 2026-06-21
 * (`git -C <dir> remote get-url origin` + `git rev-parse --abbrev-ref HEAD`).
 * Branches are a point-in-time snapshot — the localPath + remote are the
 * stable identity. Re-run the same git commands to refresh if a repo moves.
 *
 * Coupling model: only the 4 repos behind the api.coherencedaddy.com HTTP bus
 * are `coupled:true` (the control plane can reach them over HTTP). Everything
 * else is an "island" (`coupled:false`) — a repo we track for inventory but do
 * not (and in v1 cannot) reach from the control plane. This is read-only v1:
 * the registry describes reality, it does not perform git writes.
 */

export interface RepoEntry {
  key: string;
  name: string;
  remote: string;
  org: string;
  localPath: string;
  role: "full-clone" | "worktree" | "non-git";
  branch: string;
  deployTarget: string;
  coupled: boolean;
  controlBase?: string;
  notes?: string;
}

const CONTROL_BASE = "https://api.coherencedaddy.com";
const ROOT = "/Users/exe/Downloads/Claude";

export const REPO_REGISTRY: RepoEntry[] = [
  // ── Coupled (reachable over the api.coherencedaddy.com HTTP bus) ─────────
  {
    key: "team-dashboard",
    name: "Team Dashboard",
    remote: "https://github.com/ShieldnestORG/team-dashboard.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/team-dashboard`,
    role: "full-clone",
    branch: "x-accounts-optimize",
    deployTarget: "VPS4 (api.coherencedaddy.com)",
    coupled: true,
    controlBase: CONTROL_BASE,
    notes:
      "The control plane itself. Express API + admin UI; hosts this registry. Has many sibling worktrees under _wt/.",
  },
  {
    key: "coherencedaddy-landing",
    name: "Coherence Daddy Landing",
    remote: "https://github.com/ShieldnestORG/coherencedaddy.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/coherencedaddy-landing`,
    role: "full-clone",
    branch: "feat/watchtower-sitescore-aeo",
    deployTarget: "coherencedaddy.com (public marketing site)",
    coupled: true,
    controlBase: CONTROL_BASE,
    notes: "Public marketing + storefront landing. GitHub repo slug is 'coherencedaddy'.",
  },
  {
    key: "app-coherencedaddy-portal",
    name: "Coherence Daddy Portal",
    remote: "https://github.com/ShieldnestORG/app-coherencedaddy-portal.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/app-coherencedaddy-portal`,
    role: "full-clone",
    branch: "fix/watchtower-run-now-tooltip-a11y",
    deployTarget: "app.coherencedaddy.com (customer/member portal)",
    coupled: true,
    controlBase: CONTROL_BASE,
    notes: "Customer + university member portal (Stripe-gated member area).",
  },
  {
    key: "architect",
    name: "ARCHITECT",
    remote: "https://github.com/ShieldnestORG/ARCHITECT.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/architect`,
    role: "full-clone",
    branch: "feat/university-optimize-bridge",
    deployTarget: "VPS4 (api.coherencedaddy.com bridge)",
    coupled: true,
    controlBase: CONTROL_BASE,
    notes: "Orchestration / university-optimize bridge. GitHub repo slug is uppercase 'ARCHITECT'.",
  },

  // ── Islands (tracked for inventory; NOT reachable by the control plane) ──
  {
    key: "evntrace",
    name: "Evntrace",
    remote: "https://github.com/ShieldnestORG/evntrace.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/Digital Forensics`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (Evntrace billing/forensics product)",
    coupled: false,
    notes: "Local working copy lives under the 'Digital Forensics' folder.",
  },
  {
    key: "freeflow",
    name: "Freeflow",
    remote: "https://github.com/ShieldnestORG/freeflow.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/Freeflow-text to speech`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (text-to-speech)",
    coupled: false,
    notes: "Local working copy folder is 'Freeflow-text to speech'.",
  },
  {
    key: "Ladder",
    name: "Ladder",
    remote: "https://github.com/ShieldnestORG/Ladder.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/Ladder`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (pipeline/telemetry)",
    coupled: false,
    notes: "Ladder pipeline/telemetry library; consumed by team-dashboard at runtime but not control-plane reachable.",
  },
  {
    key: "Southern-Oregon-Law",
    name: "Southern Oregon Law",
    remote: "https://github.com/ShieldNEST/Southern-Oregon-Law.git",
    org: "ShieldNEST",
    localPath: `${ROOT}/Southern Oregon Law`,
    role: "full-clone",
    branch: "seo/static-schema-and-credential-fix",
    deployTarget: "standalone (client site)",
    coupled: false,
    notes: "Under the ShieldNEST org (distinct from ShieldnestORG).",
  },
  {
    key: "Personal_AI_Infrastructure",
    name: "Personal AI Infrastructure",
    remote: "https://github.com/ShieldNEST/Personal_AI_Infrastructure.git",
    org: "ShieldNEST",
    localPath: `${ROOT}/Personal_AI_Infrastructure`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (personal infra)",
    coupled: false,
    notes: "Under the ShieldNEST org.",
  },
  {
    key: "autoresearch",
    name: "Autoresearch",
    remote: "https://github.com/Coherence-Daddy/autoresearch.git",
    org: "Coherence-Daddy",
    localPath: `${ROOT}/CD-skill-research`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (research harness)",
    coupled: false,
    notes: "Under the Coherence-Daddy org; local folder is 'CD-skill-research'.",
  },
  {
    key: "advisory-board",
    name: "Advisory Board",
    remote: "https://github.com/Coherence-Daddy/advisory-board.git",
    org: "Coherence-Daddy",
    localPath: `${ROOT}/advisory-board`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone",
    coupled: false,
    notes: "Under the Coherence-Daddy org.",
  },
  {
    key: "designer-skills",
    name: "Designer Skills",
    remote: "https://github.com/Owl-Listener/designer-skills.git",
    org: "Owl-Listener",
    localPath: `${ROOT}/designer-skills`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (skills repo)",
    coupled: false,
    notes: "Under the Owl-Listener org.",
  },
  {
    key: "tx-xrpl-token-migrator",
    name: "TX XRPL Token Migrator",
    remote: "https://github.com/tokenize-x/tx-xrpl-token-migrator.git",
    org: "tokenize-x",
    localPath: `${ROOT}/tx-xrpl-token-migrator`,
    role: "full-clone",
    branch: "master",
    deployTarget: "standalone (XRPL token migration)",
    coupled: false,
    notes: "Under the tokenize-x org; default branch is 'master'.",
  },
  {
    key: "txen_arcade",
    name: "TXEN Arcade",
    remote: "https://github.com/ShieldnestORG/txen_arcade.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/txen.ai`,
    role: "full-clone",
    branch: "main",
    deployTarget: "standalone (txen.ai arcade)",
    coupled: false,
    notes: "Local working copy folder is 'txen.ai'.",
  },
  {
    key: "youtube-automation-agent",
    name: "YouTube Automation Agent",
    remote: "https://github.com/ShieldnestORG/youtube-automation-agent.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/youtube automation`,
    role: "full-clone",
    branch: "master",
    deployTarget: "standalone (YouTube automation)",
    coupled: false,
    notes: "Local working copy folder is 'youtube automation'; default branch is 'master'.",
  },
  {
    key: "toolsonhostinger",
    name: "Tools on Hostinger",
    remote: "https://github.com/ShieldnestORG/toolsonhostinger.git",
    org: "ShieldnestORG",
    localPath: `${ROOT}/toolsonhostinger`,
    role: "full-clone",
    branch: "main",
    deployTarget: "Hostinger (standalone tools)",
    coupled: false,
    notes: "Standalone tools deployed on Hostinger.",
  },
];

export interface RepoCounts {
  total: number;
  coupled: number;
  byOrg: Record<string, number>;
}

/** Top-line counts for the control-plane /repos response. */
export function getRepoCounts(): RepoCounts {
  const byOrg: Record<string, number> = {};
  let coupled = 0;
  for (const r of REPO_REGISTRY) {
    byOrg[r.org] = (byOrg[r.org] ?? 0) + 1;
    if (r.coupled) coupled += 1;
  }
  return { total: REPO_REGISTRY.length, coupled, byOrg };
}
