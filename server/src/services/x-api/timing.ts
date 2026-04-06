// ---------------------------------------------------------------------------
// X API — human-like timing utilities
// ---------------------------------------------------------------------------

/**
 * Random delay between min and max milliseconds.
 * Uses real setTimeout for server-side async execution.
 */
export function jitteredDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Check if a breathing pause is needed based on consecutive action count.
 * Uses a random threshold between minActions and maxActions so behavior
 * is not perfectly predictable.
 */
export function shouldBreathingPause(
  actionsCount: number,
  minActions = 3,
  maxActions = 5,
): boolean {
  const threshold = Math.floor(minActions + Math.random() * (maxActions - minActions + 1));
  return actionsCount >= threshold;
}

/**
 * Take a breathing pause (random 15-45 seconds by default).
 */
export function breathingPause(minSec = 15, maxSec = 45): Promise<void> {
  return jitteredDelay(minSec * 1000, maxSec * 1000);
}

/**
 * Check if current time is within active engagement hours (UTC).
 */
export function isWithinActiveHours(startHour = 9, endHour = 21): boolean {
  const hour = new Date().getUTCHours();
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Wraps past midnight (e.g., 22–6)
  return hour >= startHour || hour < endHour;
}

/**
 * Get a random item from an array.
 */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
