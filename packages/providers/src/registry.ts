// Provider registry built from environment variables, shared by the
// playground server and scripts so keys are read one way everywhere.

import { existsSync, readFileSync } from "node:fs";
import { anthropic } from "./anthropic.ts";
import { gemini } from "./gemini.ts";
import { ollama } from "./ollama.ts";
import { openai } from "./openai.ts";
import { openaiResponses } from "./openai-responses.ts";
import type { Provider } from "./types.ts";

/** Load KEY=VALUE lines into process.env; variables already set win. */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (value) process.env[m[1]!] = value;
  }
}

export interface ProviderEntry {
  id: string;
  label: string;
  available: boolean;
  /** Why it is unavailable (which variable to set). */
  reason?: string;
  defaultModel?: string;
  /** Runs on this machine (Ollama, LM Studio): no key, and listing its models is cheap. */
  local?: boolean;
  /** The variable holding its key, so a settings screen can tie a key to its provider. */
  keyVar?: string;
  make(opts?: { think?: boolean }): Provider;
}

/**
 * Labs and hosts that serve the OpenAI Chat Completions shape, declared once:
 * the registry builds their entries and settings screens list their keys from
 * this table. Differences between servers are declarations, not branches:
 * `maxTokensParam` (most only know max_tokens) and `streamUsage` (false where
 * stream_options is not documented, since an unknown field can be a 400).
 * `defaultModel` only where the lab publishes a stable alias; otherwise the
 * model comes from the server's own /models list.
 */
export interface CompatiblePreset {
  id: string;
  label: string;
  baseUrl: string;
  /** Environment variable holding the API key; none for local servers. */
  keyVar?: string;
  /** Environment variable that overrides `baseUrl`. */
  baseVar?: string;
  defaultModel?: string;
  local?: boolean;
  maxTokensParam?: "max_completion_tokens" | "max_tokens";
  streamUsage?: boolean;
}

export const COMPATIBLE_PRESETS: CompatiblePreset[] = [
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", keyVar: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest", maxTokensParam: "max_tokens", streamUsage: false },
  { id: "xai", label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", keyVar: "XAI_API_KEY", maxTokensParam: "max_tokens" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyVar: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat", maxTokensParam: "max_tokens" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyVar: "GROQ_API_KEY" },
  { id: "cerebras", label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", keyVar: "CEREBRAS_API_KEY", streamUsage: false },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyVar: "OPENROUTER_API_KEY", maxTokensParam: "max_tokens" },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", keyVar: "TOGETHER_API_KEY", maxTokensParam: "max_tokens" },
  { id: "fireworks", label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", keyVar: "FIREWORKS_API_KEY", maxTokensParam: "max_tokens" },
  { id: "moonshot", label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.ai/v1", keyVar: "MOONSHOT_API_KEY", maxTokensParam: "max_tokens", streamUsage: false },
  { id: "qwen", label: "Alibaba Qwen (DashScope)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyVar: "DASHSCOPE_API_KEY", maxTokensParam: "max_tokens" },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1", baseVar: "LMSTUDIO_BASE_URL", local: true, maxTokensParam: "max_tokens" },
];

/** One variable a settings screen can edit. */
export interface ProviderSetting {
  name: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  /** "main": shown up front; "more": behind a disclosure until set. */
  group: "main" | "more";
  /** The provider entry it configures. */
  provider: string;
}

/** Every variable providersFromEnv reads, for settings screens (keys, hosts, endpoints). */
export const PROVIDER_SETTINGS: ProviderSetting[] = [
  { name: "ANTHROPIC_API_KEY", label: "Anthropic API key", secret: true, group: "main", provider: "anthropic" },
  { name: "OPENAI_API_KEY", label: "OpenAI API key", secret: true, group: "main", provider: "openai" },
  { name: "GEMINI_API_KEY", label: "Google Gemini API key", secret: true, group: "main", provider: "gemini" },
  { name: "OLLAMA_HOST", label: "Ollama host", secret: false, placeholder: "http://127.0.0.1:11434", group: "main", provider: "ollama" },
  { name: "OLLAMA_MODEL", label: "Default Ollama model", secret: false, placeholder: "qwen3.5:4b-mlx", group: "more", provider: "ollama" },
  ...COMPATIBLE_PRESETS.flatMap((p): ProviderSetting[] => [
    ...(p.keyVar ? [{ name: p.keyVar, label: `${p.label} API key`, secret: true, group: "more" as const, provider: p.id }] : []),
    ...(p.baseVar ? [{ name: p.baseVar, label: `${p.label} URL`, secret: false, placeholder: p.baseUrl, group: "more" as const, provider: p.id }] : []),
  ]),
  { name: "OPENAI_COMPAT_BASE_URL", label: "Base URL", secret: false, placeholder: "https://host/v1", group: "more", provider: "compatible" },
  { name: "OPENAI_COMPAT_API_KEY", label: "API key", secret: true, group: "more", provider: "compatible" },
];

export function providersFromEnv(env: Record<string, string | undefined> = process.env): ProviderEntry[] {
  const ollamaHost = env.OLLAMA_HOST ? (env.OLLAMA_HOST.startsWith("http") ? env.OLLAMA_HOST : `http://${env.OLLAMA_HOST}`) : "http://127.0.0.1:11434";
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  return [
    {
      id: "ollama",
      label: "Ollama (local)",
      available: true,
      local: true,
      // The primary target (AGENTS.md). Without it the first installed model was
      // picked, and that was the 0.8B one.
      defaultModel: env.OLLAMA_MODEL ?? "qwen3.5:4b-mlx",
      make: (o = {}) => ollama({ host: ollamaHost, think: o.think }),
    },
    {
      id: "anthropic",
      label: "Anthropic",
      available: Boolean(env.ANTHROPIC_API_KEY),
      reason: "set ANTHROPIC_API_KEY",
      keyVar: "ANTHROPIC_API_KEY",
      defaultModel: "claude-opus-5-5",
      make: () => anthropic({ apiKey: env.ANTHROPIC_API_KEY!, baseUrl: env.ANTHROPIC_BASE_URL }),
    },
    {
      id: "openai",
      label: "OpenAI",
      available: Boolean(env.OPENAI_API_KEY),
      reason: "set OPENAI_API_KEY",
      keyVar: "OPENAI_API_KEY",
      // OpenAI's own API uses Responses; compatible endpoints keep Chat Completions.
      make: () => openaiResponses({ apiKey: env.OPENAI_API_KEY!, baseUrl: env.OPENAI_BASE_URL }),
    },
    {
      id: "gemini",
      label: "Google Gemini",
      available: Boolean(geminiKey),
      reason: "set GEMINI_API_KEY",
      keyVar: "GEMINI_API_KEY",
      make: () => gemini({ apiKey: geminiKey! }),
    },
    ...COMPATIBLE_PRESETS.map((p): ProviderEntry => {
      const apiKey = p.keyVar ? env[p.keyVar] : undefined;
      return {
        id: p.id,
        label: p.label,
        available: p.local || Boolean(apiKey),
        reason: p.keyVar ? `set ${p.keyVar}` : undefined,
        keyVar: p.keyVar,
        defaultModel: p.defaultModel,
        local: p.local,
        make: () => openai({ id: p.id, apiKey, baseUrl: (p.baseVar && env[p.baseVar]) || p.baseUrl, maxTokensParam: p.maxTokensParam, streamUsage: p.streamUsage }),
      };
    }),
    {
      id: "compatible",
      label: env.OPENAI_COMPAT_LABEL ?? "OpenAI-compatible",
      available: Boolean(env.OPENAI_COMPAT_BASE_URL),
      reason: "set OPENAI_COMPAT_BASE_URL",
      keyVar: "OPENAI_COMPAT_API_KEY",
      make: () => openai({ id: "compatible", apiKey: env.OPENAI_COMPAT_API_KEY, baseUrl: env.OPENAI_COMPAT_BASE_URL }),
    },
  ];
}
