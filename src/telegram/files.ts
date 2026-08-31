import { log } from "../log.ts";

const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
// in-flight buffers are unmeasured until they land, so the byte cap cannot bound them
const MAX_CONCURRENT_DOWNLOADS = 3;

const EXT_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/typescript",
  java: "text/x-java-source",
  c: "text/x-c",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  swift: "text/x-swift",
  php: "text/x-php",
  rb: "text/x-ruby",
  kt: "text/x-kotlin",
  go: "text/x-go",
  rs: "text/rust",
  html: "text/html",
  css: "text/css",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "text/xml",
};

/** MIME priority: Telegram-provided → photo default (jpeg) → extension map → octet-stream. */
export function resolveMime(input: {
  mimeType?: string | null;
  fileName?: string | null;
  kind?: "photo" | "document";
}): string {
  if (input.mimeType) return input.mimeType;
  if (input.kind === "photo") return "image/jpeg";
  const ext = input.fileName?.split(".").pop()?.toLowerCase();
  // own-property only: a `.constructor` extension must not resolve up the prototype chain
  const mapped = ext !== undefined && Object.hasOwn(EXT_MIME, ext) ? EXT_MIME[ext] : undefined;
  return mapped ?? "application/octet-stream";
}

/** file_id → Buffer cache, 64MiB byte-capped LRU (Map re-insertion marks recency). */
export class FileCache {
  private readonly entries = new Map<string, Promise<Buffer>>();
  private readonly sizes = new Map<string, number>();
  private totalBytes = 0;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly fetchBuffer: (fileId: string) => Promise<Buffer>;

  constructor(fetchBuffer: (fileId: string) => Promise<Buffer>) {
    this.fetchBuffer = fetchBuffer;
  }

  /** Concurrent callers for one file share a single download, counted once. */
  get(fileId: string): Promise<Buffer> {
    const hit = this.entries.get(fileId);
    if (hit) {
      this.entries.delete(fileId);
      this.entries.set(fileId, hit);
      return hit;
    }

    const pending = this.load(fileId);
    this.entries.set(fileId, pending);
    return pending;
  }

  private async load(fileId: string): Promise<Buffer> {
    await this.acquireSlot();
    try {
      const buffer = await this.fetchBuffer(fileId);
      this.sizes.set(fileId, buffer.byteLength);
      this.totalBytes += buffer.byteLength;
      this.evictOverflow();
      return buffer;
    } catch (error) {
      this.entries.delete(fileId);
      throw error;
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT_DOWNLOADS) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Hand the slot straight to the next waiter, so `active` never dips below demand. */
  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  private evictOverflow(): void {
    while (this.totalBytes > CACHE_MAX_BYTES && this.entries.size > 1) {
      // in-flight entries have no size yet — evicting one would strand its bytes
      const oldest = [...this.entries.keys()].find((key) => this.sizes.has(key));
      if (oldest === undefined) return;
      this.entries.delete(oldest);
      this.totalBytes -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
      log.debug({ fileId: oldest }, "파일 캐시 축출");
    }
  }
}

export function createTelegramFileFetcher(
  getFile: (fileId: string) => Promise<{ file_path?: string }>,
  token: string,
): (fileId: string) => Promise<Buffer> {
  return async (fileId) => {
    const file = await getFile(fileId);
    if (!file.file_path) throw new Error(`file_path 없음: ${fileId}`);
    // grammY bounds getFile itself; this raw read is the one call with no deadline
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`파일 다운로드 실패 (${response.status}): ${fileId}`);
    return Buffer.from(await response.arrayBuffer());
  };
}
