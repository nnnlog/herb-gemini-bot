export const MAX_LENGTH = 4096;
export const CAPTION_MAX_LENGTH = 1024;

interface OpenTag {
  name: string;
  open: string;
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>/g;

/**
 * Split finished Telegram HTML into sendable chunks: line-based accumulation,
 * closing open tags at each boundary and reopening them in the next chunk.
 * Overlong single lines are cut outside tags, entities and surrogate pairs.
 */
export function splitHtml(html: string, firstChunkLimit: number = MAX_LENGTH): string[] {
  if (html.trim() === "") return [];

  const chunks: string[] = [];
  let stack: OpenTag[] = [];
  let current = "";
  let limit = firstChunkLimit;

  const finalize = (): void => {
    emit(chunks, current.replace(/\n+$/, "") + closersOf(stack));
    current = "";
    limit = MAX_LENGTH;
  };

  for (const rawLine of html.split("\n")) {
    const stackAfter = [...stack];
    scanTags(rawLine, stackAfter);
    const joined = current === "" ? rawLine : `${current}\n${rawLine}`;

    if (joined.length + closersLengthOf(stackAfter) <= limit) {
      current = joined;
      stack = stackAfter;
      continue;
    }

    let line = rawLine;
    if (current !== "") {
      // finalize before this line and reopen the still-open tags in the next chunk
      const reopen = openersOf(stack);
      finalize();
      stack = [];
      line = reopen + line;
    }

    const rest = cutLine(line, limit, chunks);
    current = rest.text;
    stack = rest.stack;
    limit = MAX_LENGTH;
  }

  if (current !== "") finalize();
  return chunks;
}

/**
 * Emit an over-long line as chunks, then return the trailing piece that fits.
 * Each pass rescans only the segment it emits, so the whole line is walked a
 * bounded number of times regardless of its length.
 */
function cutLine(
  line: string,
  firstLimit: number,
  out: string[],
): { text: string; stack: OpenTag[] } {
  let limit = firstLimit;
  let segStart = 0;
  let openers = "";
  let stack: OpenTag[] = [];

  for (;;) {
    const at = findCut(line, segStart, stack, openers.length, limit);
    if (at === undefined) break;

    const segment = line.slice(segStart, at);
    const stackAtCut = [...stack];
    scanTags(segment, stackAtCut);
    emit(out, openers + segment + closersOf(stackAtCut));

    openers = openersOf(stackAtCut);
    stack = stackAtCut;
    // openers with no room left for content would repeat on every pass, one character
    // at a time — drop the formatting instead and emit the remainder plain
    if (openers.length + closersLengthOf(stack) >= MAX_LENGTH) {
      openers = "";
      stack = [];
    }
    segStart = at;
    limit = MAX_LENGTH;
  }

  const tail = line.slice(segStart);
  const tailStack = [...stack];
  scanTags(tail, tailStack);
  return { text: openers + tail, stack: tailStack };
}

/**
 * Index at which the piece starting at `from` must be cut, or undefined when the
 * rest of the line fits. A cut never lands inside a tag and always carries at
 * least one character of content, so the caller always makes progress. A tag too
 * long to fit on its own is emitted whole, overflowing the limit rather than
 * being broken.
 */
function findCut(
  line: string,
  from: number,
  baseStack: readonly OpenTag[],
  openersLen: number,
  limit: number,
): number | undefined {
  const stack = [...baseStack];
  let closers = closersLengthOf(stack);
  let best = from;
  let inTag = false;
  let tagStart = 0;
  let sawContent = false;

  for (let i = from; i < line.length; i++) {
    const ch = line[i];
    if (!inTag && ch === "<") {
      inTag = true;
      tagStart = i;
    } else if (inTag && ch === ">") {
      inTag = false;
      scanTags(line.slice(tagStart, i + 1), stack);
      closers = closersLengthOf(stack);
    } else if (!inTag) {
      sawContent = true;
    }
    if (inTag || !sawContent) continue;

    const at = safeBoundary(line, i + 1);
    if (at <= best) continue;
    if (openersLen + (at - from) + closers <= limit) best = at;
    else if (best > from) return best;
    else return at;
  }

  if (openersLen + (line.length - from) + closers <= limit) return undefined;
  return best > from ? best : undefined;
}

/** Telegram rejects a message with no visible characters, so tag-only chunks are dropped. */
function emit(out: string[], chunk: string): void {
  if (chunk.replace(TAG_RE, "").trim() !== "") out.push(chunk);
}

function scanTags(fragment: string, stack: OpenTag[]): void {
  TAG_RE.lastIndex = 0;
  let match = TAG_RE.exec(fragment);
  while (match !== null) {
    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.name === name) {
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push({ name, open: match[0] });
    }
    match = TAG_RE.exec(fragment);
  }
}

function closersOf(stack: readonly OpenTag[]): string {
  return [...stack]
    .reverse()
    .map((t) => `</${t.name}>`)
    .join("");
}

function closersLengthOf(stack: readonly OpenTag[]): number {
  let total = 0;
  for (const tag of stack) total += tag.name.length + 3;
  return total;
}

function openersOf(stack: readonly OpenTag[]): string {
  return stack.map((t) => t.open).join("");
}

/** Pull a cut point out of an `&...;` entity (8-char lookback) or a surrogate pair. */
function safeBoundary(line: string, at: number): number {
  let cutAt = at;
  const prev = line.charCodeAt(cutAt - 1);
  if (prev >= 0xd800 && prev <= 0xdbff) cutAt -= 1;
  for (let back = 1; back <= 8 && cutAt - back >= 0; back++) {
    const ch = line[cutAt - back];
    if (ch === ";") return cutAt;
    if (ch === "&") return cutAt - back;
  }
  return cutAt;
}
