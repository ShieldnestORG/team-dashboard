import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  DraftNumberInput,
} from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function OllamaLocalConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  models,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Model" hint="Ollama model to use for this agent. Models are pulled on the Ollama server.">
        {isCreate ? (
          <select
            value={values?.model || "qwen2.5:7b"}
            onChange={(e) => set?.({ model: e.target.value })}
            className={inputClass}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        ) : (
          <select
            value={eff("adapterConfig", "model", String(config.model || "qwen2.5:7b"))}
            onChange={(e) => mark("adapterConfig", "model", e.target.value)}
            className={inputClass}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Ollama URL" hint="Base URL of the Ollama API (default: env OLLAMA_URL)">
        <DraftInput
          value={
            isCreate
              ? (values as unknown as Record<string, unknown>)?.ollamaUrl as string ?? ""
              : eff("adapterConfig", "ollamaUrl", String(config.ollamaUrl ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set?.({ ...values, ollamaUrl: v } as unknown as never)
              : mark("adapterConfig", "ollamaUrl", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="http://172.17.0.1:11434"
        />
      </Field>

      <Field label="Temperature" hint="Sampling temperature (0-2, default: 0.7)">
        <DraftNumberInput
          value={
            isCreate
              ? 0.7
              : eff("adapterConfig", "temperature", Number(config.temperature ?? 0.7))
          }
          onCommit={(v) =>
            isCreate
              ? set?.({} as never)
              : mark("adapterConfig", "temperature", v)
          }
          className={inputClass}
          placeholder="0.7"
        />
      </Field>

      <Field label="Max Tokens" hint="Maximum tokens to generate (default: 4096)">
        <DraftNumberInput
          value={
            isCreate
              ? 4096
              : eff("adapterConfig", "maxTokens", Number(config.maxTokens ?? 4096))
          }
          onCommit={(v) =>
            isCreate
              ? set?.({} as never)
              : mark("adapterConfig", "maxTokens", v)
          }
          className={inputClass}
          placeholder="4096"
        />
      </Field>
    </>
  );
}
