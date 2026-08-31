import { scheduler } from "node:timers/promises";
import type {
  Content,
  GenerateContentConfig,
  GenerateContentParameters,
  GenerateContentResponse,
  GroundingMetadata,
  Part,
} from "@google/genai";
import { FinishReason } from "@google/genai";
import { log } from "../log.ts";
import { strings } from "../strings.ts";

/** Gemini port — the boundary faked in tests. Real implementation: `new GoogleGenAI(...).models`. */
export interface GeminiPort {
  generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
}

export interface GenRequest {
  model: string;
  contents: Content[];
  config: GenerateContentConfig;
}

export interface GenImage {
  buffer: Buffer;
  mimeType: string;
}

export type GenResult =
  | {
      ok: true;
      parts: Part[];
      images: GenImage[];
      text?: string;
      groundingMetadata?: GroundingMetadata;
    }
  | { ok: false; userMessage: string };

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10 * 60 * 1000;

export class GeminiClient {
  private readonly port: GeminiPort;
  private readonly shutdownSignal: AbortSignal;

  constructor(port: GeminiPort, shutdownSignal: AbortSignal) {
    this.port = port;
    this.shutdownSignal = shutdownSignal;
  }

  async generate(request: GenRequest): Promise<GenResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // fresh signal per attempt — a spent signal would fail every retry instantly
      const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), this.shutdownSignal]);
      try {
        const response = await this.port.generateContent({
          model: request.model,
          contents: request.contents,
          config: { ...request.config, abortSignal: signal, httpOptions: { timeout: TIMEOUT_MS } },
        });
        return classifyResponse(response);
      } catch (error) {
        const cls = classifyError(error);
        if (cls.retryable && attempt < MAX_ATTEMPTS) {
          log.warn({ err: error, attempt }, "gemini 호출 실패, 재시도");
          await delay(cls.retryAfterMs ?? attempt * 1000 + 1000, this.shutdownSignal); // 2s, 3s; 429 hint wins
          continue;
        }
        log.error({ err: error }, "gemini 호출 실패");
        return { ok: false, userMessage: cls.userMessage };
      }
    }
    return { ok: false, userMessage: strings.errors.retriesExhausted }; // unreachable fallback
  }
}

function classifyResponse(response: GenerateContentResponse): GenResult {
  const feedbackReason = response.promptFeedback?.blockReason;
  if (feedbackReason) {
    return { ok: false, userMessage: strings.errors.promptBlocked(String(feedbackReason)) };
  }

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === FinishReason.SAFETY || finishReason === FinishReason.PROHIBITED_CONTENT) {
    return { ok: false, userMessage: strings.errors.safetyBlocked };
  }
  if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
    return { ok: false, userMessage: strings.errors.malformedFunctionCall };
  }

  const parts = candidate?.content?.parts ?? [];
  const images: GenImage[] = [];
  for (const cand of response.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.mimeType?.startsWith("image/") && part.inlineData.data) {
        images.push({
          buffer: Buffer.from(part.inlineData.data, "base64"),
          mimeType: part.inlineData.mimeType,
        });
      }
    }
  }

  const text = response.text;
  const grounding = candidate?.groundingMetadata;
  if (parts.length === 0 && images.length === 0 && !text) {
    return { ok: false, userMessage: strings.errors.emptyResponse };
  }
  return {
    ok: true,
    parts,
    images,
    ...(text ? { text } : {}),
    ...(grounding ? { groundingMetadata: grounding } : {}),
  };
}

interface ErrorClass {
  retryable: boolean;
  userMessage: string;
  retryAfterMs?: number;
}

// Gemini error bodies arrive stringified in `message`; these are their canonical status names.
const STATUS_NAMES: Readonly<Record<string, number>> = {
  RESOURCE_EXHAUSTED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
  DEADLINE_EXCEEDED: 504,
};

const MAX_RETRY_DELAY_MS = 30 * 1000;
// a server hint of "0s" must not collapse the backoff into a burst
const MIN_RETRY_DELAY_MS = 1000;

function classifyError(error: unknown): ErrorClass {
  const err = error as { message?: unknown; status?: unknown; name?: unknown } | null;
  const message = typeof err?.message === "string" ? err.message : String(error);
  const name = typeof err?.name === "string" ? err.name : "";

  // timeouts/aborts are not auto-retried — manual 🔄 only
  if (name === "AbortError" || name === "TimeoutError") {
    return { retryable: false, userMessage: strings.errors.timeout };
  }

  const status = typeof err?.status === "number" ? err.status : statusOf(message);
  if (status === 429) {
    const hint = parseRetryDelayMs(message);
    return {
      retryable: true,
      userMessage: strings.errors.rateLimited,
      ...(hint !== undefined ? { retryAfterMs: hint } : {}),
    };
  }
  if (status === 503) return { retryable: true, userMessage: strings.errors.overloaded };
  if (status === 500 || status === 502 || status === 504) {
    return { retryable: true, userMessage: strings.errors.apiError };
  }
  if (status === undefined) {
    if (message.includes("aborted")) {
      return { retryable: false, userMessage: strings.errors.timeout };
    }
    if (message.includes("fetch failed")) {
      return { retryable: true, userMessage: strings.errors.apiError };
    }
  }
  return { retryable: false, userMessage: strings.errors.apiError };
}

/** Read the status out of the error body's own fields — never from loose digits in prose. */
function statusOf(message: string): number | undefined {
  const code = /"code"\s*:\s*(\d{3})\b/.exec(message);
  if (code?.[1] !== undefined) return Number(code[1]);
  const name = /"status"\s*:\s*"([A-Z_]+)"/.exec(message);
  return name?.[1] !== undefined ? STATUS_NAMES[name[1]] : undefined;
}

/** Best-effort parse of RetryInfo (`"retryDelay":"7s"`) from a 429 body, capped. */
function parseRetryDelayMs(message: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  if (!match?.[1]) return undefined;
  const hint = Math.round(Number(match[1]) * 1000);
  return Math.min(Math.max(hint, MIN_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return scheduler.wait(ms, { signal }).catch(() => undefined);
}
