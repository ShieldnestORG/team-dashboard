// Learn-hub progress — localStorage v1, per the affiliate-learn curriculum spec
// ("lightweight save-for-later / mark-as-read state; localStorage fine for v1,
// no DB"). DB-backed certification stays deferred until engagement data exists.
//
// Single device-scoped store shared by anonymous and logged-in readers — the
// public /learn doubles as a recruitment surface, and pre-signup reading
// carrying over after signup is the desired behavior.

const STORAGE_KEY = "affiliateLearnProgress.v1";

export interface GuideProgress {
  /** Highest step index reached (0-based). */
  lastStep: number;
  /** ISO timestamp of first completion, or null. */
  completedAt: string | null;
  /** Step indexes whose recall check was passed. */
  passedChecks: number[];
}

interface ProgressStore {
  v: 1;
  guides: Record<string, GuideProgress>;
}

function load(): ProgressStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProgressStore;
      if (parsed && parsed.v === 1 && parsed.guides) return parsed;
    }
  } catch {
    // corrupted or unavailable storage — start fresh
  }
  return { v: 1, guides: {} };
}

function save(store: ProgressStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota/private-mode — progress is best-effort
  }
}

function update(slug: string, fn: (g: GuideProgress) => void): void {
  const store = load();
  const g = store.guides[slug] ?? { lastStep: 0, completedAt: null, passedChecks: [] };
  fn(g);
  store.guides[slug] = g;
  save(store);
}

export function getGuideProgress(slug: string): GuideProgress | null {
  return load().guides[slug] ?? null;
}

export function recordStep(slug: string, stepIdx: number): void {
  update(slug, (g) => {
    g.lastStep = Math.max(g.lastStep, stepIdx);
  });
}

export function recordCheckPassed(slug: string, stepIdx: number): void {
  update(slug, (g) => {
    if (!g.passedChecks.includes(stepIdx)) g.passedChecks.push(stepIdx);
  });
}

export function recordCompleted(slug: string): void {
  update(slug, (g) => {
    if (!g.completedAt) g.completedAt = new Date().toISOString();
  });
}

export type GuideState = "unread" | "in-progress" | "completed";

export function getGuideState(slug: string): GuideState {
  const g = getGuideProgress(slug);
  if (!g) return "unread";
  if (g.completedAt) return "completed";
  return "in-progress";
}

/** Index-page summary: completion count plus the most recent unfinished guide. */
export function getProgressSummary(allSlugs: string[]): {
  completed: number;
  total: number;
  resumeSlug: string | null;
  resumeStep: number;
} {
  const store = load();
  let completed = 0;
  let resumeSlug: string | null = null;
  let resumeStep = 0;
  for (const slug of allSlugs) {
    const g = store.guides[slug];
    if (!g) continue;
    if (g.completedAt) {
      completed += 1;
    } else if (g.lastStep > 0 && resumeSlug === null) {
      resumeSlug = slug;
      resumeStep = g.lastStep;
    }
  }
  return { completed, total: allSlugs.length, resumeSlug, resumeStep };
}
