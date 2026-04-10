/**
 * Ollama Local Adapter — routes agent execution through a local Ollama instance.
 *
 * Uses the /api/chat endpoint for conversation-style interaction.
 * Cost is $0 since it's a local model.
 */

import type {
  ServerAdapterModule,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterModel,
} from "@paperclipai/adapter-utils";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Models (defaults — listModels dynamically fetches from Ollama)
// ---------------------------------------------------------------------------

const defaultModels: AdapterModel[] = [
  { id: "qwen2.5:7b", label: "Qwen 2.5 7B" },
  { id: "qwen2.5:1.5b", label: "Qwen 2.5 1.5B" },
  { id: "qwen2.5:14b", label: "Qwen 2.5 14B" },
  { id: "qwen2.5:32b", label: "Qwen 2.5 32B" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B" },
  { id: "deepseek-coder-v2:16b", label: "DeepSeek Coder V2 16B" },
];

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getOllamaUrl(config: Record<string, unknown>): string {
  return (config.ollamaUrl as string) || process.env.OLLAMA_URL || "http://168.231.127.180:11434";
}

function getModel(config: Record<string, unknown>): string {
  return (config.model as string) || process.env.OLLAMA_AGENT_MODEL || "qwen2.5:7b";
}

function getTemperature(config: Record<string, unknown>): number {
  const t = config.temperature;
  return typeof t === "number" ? t : 0.7;
}

function getMaxTokens(config: Record<string, unknown>): number {
  const m = config.maxTokens;
  return typeof m === "number" ? m : 4096;
}

// ---------------------------------------------------------------------------
// Build prompt from context
// ---------------------------------------------------------------------------

function buildPrompt(ctx: AdapterExecutionContext): { system: string; user: string } {
  const context = ctx.context;
  const agent = ctx.agent;

  // System prompt: agent instructions
  let system = "";
  if (context.instructions && typeof context.instructions === "string") {
    system = context.instructions;
  } else if (context.systemPrompt && typeof context.systemPrompt === "string") {
    system = context.systemPrompt;
  } else {
    system = `You are ${agent.name}, an AI agent. Complete the assigned task thoroughly and accurately.`;
  }

  // User prompt: task context
  const parts: string[] = [];

  if (context.issueTitle) parts.push(`## Task: ${context.issueTitle}`);
  if (context.issueBody) parts.push(`\n${context.issueBody}`);
  if (context.prompt && typeof context.prompt === "string") parts.push(context.prompt);

  // Comments context
  if (Array.isArray(context.comments)) {
    for (const c of context.comments as Array<{ author?: string; body?: string }>) {
      if (c.body) parts.push(`\n**${c.author || "Comment"}:** ${c.body}`);
    }
  }

  if (parts.length === 0) {
    parts.push("Please check for any pending work and provide a status update.");
  }

  return { system, user: parts.join("\n") };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, onLog, onMeta } = ctx;

  const ollamaUrl = getOllamaUrl(config);
  const model = getModel(config);
  const temperature = getTemperature(config);
  const maxTokens = getMaxTokens(config);

  const { system, user } = buildPrompt(ctx);

  await onLog("stdout", `[ollama] Using model ${model} at ${ollamaUrl}\n`);

  if (onMeta) {
    await onMeta({
      adapterType: "ollama_local",
      command: `ollama chat ${model}`,
      prompt: user.slice(0, 500),
      context: { ollamaUrl, model, temperature, maxTokens },
    });
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      model?: string;
    };

    const assistantMessage = data.message?.content || "";
    const inputTokens = data.prompt_eval_count || 0;
    const outputTokens = data.eval_count || 0;

    await onLog("stdout", assistantMessage + "\n");

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens, outputTokens },
      model: data.model || model,
      provider: "ollama",
      billingType: "fixed",
      costUsd: 0,
      summary: assistantMessage.slice(0, 500),
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const timedOut = errorMessage.includes("timeout") || errorMessage.includes("abort");
    await onLog("stderr", `[ollama] Error: ${errorMessage}\n`);

    return {
      exitCode: 1,
      signal: null,
      timedOut,
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const ollamaUrl = getOllamaUrl(ctx.config);
  const configuredModel = getModel(ctx.config);

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      const modelNames = data.models?.map((m) => m.name) || [];
      checks.push({
        code: "ollama_reachable",
        level: "info",
        message: `Ollama reachable at ${ollamaUrl}, ${modelNames.length} model(s) available`,
      });

      if (modelNames.some((n) => n.startsWith(configuredModel))) {
        checks.push({
          code: "model_available",
          level: "info",
          message: `Model ${configuredModel} is available`,
        });
      } else {
        checks.push({
          code: "model_missing",
          level: "error",
          message: `Model ${configuredModel} not found. Available: ${modelNames.join(", ")}`,
          hint: `Run \`ollama pull ${configuredModel}\` on the Ollama server`,
        });
      }
    } else {
      checks.push({
        code: "ollama_error",
        level: "error",
        message: `Ollama returned HTTP ${res.status}`,
      });
    }
  } catch (err) {
    checks.push({
      code: "ollama_unreachable",
      level: "error",
      message: `Cannot reach Ollama at ${ollamaUrl}: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Ensure Ollama is running and the URL is correct",
    });
  }

  return {
    adapterType: "ollama_local",
    status: checks.some((c) => c.level === "error") ? "fail" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dynamic model listing from Ollama API
// ---------------------------------------------------------------------------

async function listModels(): Promise<AdapterModel[]> {
  const ollamaUrl = process.env.OLLAMA_URL || "http://168.231.127.180:11434";
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
      if (data.models && data.models.length > 0) {
        return data.models.map((m) => ({
          id: m.name,
          label: `${m.name}${m.details?.parameter_size ? ` (${m.details.parameter_size})` : ""}`,
        }));
      }
    }
  } catch {
    logger.debug("Failed to list Ollama models dynamically");
  }
  return defaultModels;
}

// ---------------------------------------------------------------------------
// Export adapter module
// ---------------------------------------------------------------------------

export const ollamaLocalAdapter: ServerAdapterModule = {
  type: "ollama_local",
  execute,
  testEnvironment,
  models: defaultModels,
  listModels,
  supportsLocalAgentJwt: false,
  agentConfigurationDoc: `## Ollama Local Adapter

Connects to a local Ollama instance for LLM inference. Free — no API costs.

### Configuration
- **ollamaUrl**: Ollama API base URL (default: env OLLAMA_URL or http://168.231.127.180:11434)
- **model**: Model to use (default: qwen2.5:7b, or env OLLAMA_AGENT_MODEL)
- **temperature**: Sampling temperature 0-2 (default: 0.7)
- **maxTokens**: Max tokens to generate (default: 4096)

### Models
Models are dynamically loaded from Ollama. To add a model:
\`\`\`bash
ollama pull qwen2.5:14b  # on the Ollama server
\`\`\`
`,
};
