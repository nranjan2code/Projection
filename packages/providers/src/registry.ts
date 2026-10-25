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
  make(opts?: { think?: boolean }): Provider;
}

export function providersFromEnv(env: Record<string, string | undefined> = process.env): ProviderEntry[] {
  const ollamaHost = env.OLLAMA_HOST ? (env.OLLAMA_HOST.startsWith("http") ? env.OLLAMA_HOST : `http://${env.OLLAMA_HOST}`) : "http://127.0.0.1:11434";
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  return [
    {
      id: "ollama",
      label: "Ollama (local)",
      available: true,
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
      defaultModel: "claude-opus-5-5",
      make: () => anthropic({ apiKey: env.ANTHROPIC_API_KEY!, baseUrl: env.ANTHROPIC_BASE_URL }),
    },
    {
      id: "openai",
      label: "OpenAI",
      available: Boolean(env.OPENAI_API_KEY),
      reason: "set OPENAI_API_KEY",
      // OpenAI's own API uses Responses; compatible endpoints keep Chat Completions.
      make: () => openaiResponses({ apiKey: env.OPENAI_API_KEY!, baseUrl: env.OPENAI_BASE_URL }),
    },
    {
      id: "gemini",
      label: "Google Gemini",
      available: Boolean(geminiKey),
      reason: "set GEMINI_API_KEY",
      make: () => gemini({ apiKey: geminiKey! }),
    },
    {
      id: "compatible",
      label: env.OPENAI_COMPAT_LABEL ?? "OpenAI-compatible",
      available: Boolean(env.OPENAI_COMPAT_BASE_URL),
      reason: "set OPENAI_COMPAT_BASE_URL",
      make: () => openai({ id: "compatible", apiKey: env.OPENAI_COMPAT_API_KEY, baseUrl: env.OPENAI_COMPAT_BASE_URL }),
    },
  ];
}
