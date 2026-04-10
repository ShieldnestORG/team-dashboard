import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";
import { appendEvalResult } from "./eval-store.js";
import { sendAlert } from "./alerting.js";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

async function runSmokeEval(): Promise<void> {
  const evalDir = join(process.cwd(), "evals", "promptfoo");
  if (!existsSync(join(evalDir, "promptfooconfig.yaml"))) {
    logger.warn("Eval config not found, skipping eval:smoke");
    return;
  }

  const outputPath = `/tmp/paperclip-eval-${Date.now()}.json`;
  const startTime = Date.now();

  try {
    execSync(
      `npx promptfoo@0.103.3 eval --output ${outputPath} --no-cache`,
      {
        cwd: evalDir,
        timeout: 300_000,
        stdio: "pipe",
        env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` },
      },
    );
  } catch (err) {
    logger.warn({ err }, "eval:smoke command failed");
  }

  const durationMs = Date.now() - startTime;

  // Try to parse output
  let totalTests = 0;
  let passed = 0;
  let failed = 0;
  const results: Array<{
    case: string;
    provider: string;
    pass: boolean;
    score: number;
  }> = [];

  if (existsSync(outputPath)) {
    try {
      const raw = JSON.parse(readFileSync(outputPath, "utf-8"));
      // promptfoo output has results.results array
      const evalResults = raw?.results?.results || raw?.results || [];
      for (const r of evalResults) {
        totalTests++;
        const pass = r.success ?? r.pass ?? false;
        if (pass) passed++;
        else failed++;
        results.push({
          case:
            r.testCase?.description ||
            r.vars?.description ||
            `test-${totalTests}`,
          provider: r.provider?.id || r.provider || "unknown",
          pass,
          score: r.score ?? (pass ? 1 : 0),
        });
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // If we couldn't parse, at least record the run happened
  if (totalTests === 0) {
    totalTests = 1;
    passed = 0;
    failed = 1;
  }

  appendEvalResult({
    ranAt: new Date().toISOString(),
    durationMs,
    totalTests,
    passed,
    failed,
    results,
    trigger: "cron",
  });
  logger.info({ passed, failed, totalTests, durationMs }, "eval:smoke completed");

  if (failed > 0) {
    const failedCases = results.filter(r => !r.pass).map(r => `${r.case} (${r.provider})`).join(", ");
    await sendAlert("eval_failed", `Eval smoke failed: ${failed}/${totalTests} tests`, `Failed cases:\n${failedCases}\n\nDuration: ${durationMs}ms`);
  }
}

export function startEvalCrons() {
  registerCronJob({ jobName: "eval:smoke", schedule: "0 6 * * *", ownerAgent: "nova", sourceFile: "eval-crons.ts", handler: runSmokeEval });

  logger.info({ count: 1 }, "Eval cron jobs registered");
}
