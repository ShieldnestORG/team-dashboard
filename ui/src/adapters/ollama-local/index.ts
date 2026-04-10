import type { UIAdapterModule, CreateConfigValues } from "../types";
import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { OllamaLocalConfigFields } from "./config-fields";

function parseOllamaStdoutLine(line: string, ts: string): TranscriptEntry[] {
  // Ollama adapter outputs plain text — treat everything as assistant text
  if (line.startsWith("[ollama]")) {
    return [{ kind: "system", ts, text: line }];
  }
  return [{ kind: "assistant", ts, text: line }];
}

function buildOllamaConfig(values: CreateConfigValues): Record<string, unknown> {
  return {
    model: values.model || "qwen2.5:7b",
    ollamaUrl: (values as unknown as Record<string, unknown>).ollamaUrl || undefined,
    temperature: 0.7,
    maxTokens: 4096,
  };
}

export const ollamaLocalUIAdapter: UIAdapterModule = {
  type: "ollama_local",
  label: "Ollama (local)",
  parseStdoutLine: parseOllamaStdoutLine,
  ConfigFields: OllamaLocalConfigFields,
  buildAdapterConfig: buildOllamaConfig,
};
