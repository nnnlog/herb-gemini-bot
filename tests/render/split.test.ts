import { expect, it } from "vitest";
import { CAPTION_MAX_LENGTH, MAX_LENGTH, splitHtml } from "../../src/render/split.ts";

it("a document within the limit stays one chunk", () => {
  expect(splitHtml("hello\nworld")).toEqual(["hello\nworld"]);
});

it("an empty document yields no chunks", () => {
  expect(splitHtml("  \n ")).toEqual([]);
});

it("multi-line documents split on line boundaries within the limit", () => {
  const line = "x".repeat(1000);
  const chunks = splitHtml(Array.from({ length: 10 }, () => line).join("\n"));
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_LENGTH);
  expect(chunks.join("\n").replaceAll("\n", "")).toBe("x".repeat(10000));
});

it("a <pre><code> spanning chunks is closed and reopened", () => {
  const codeLines = Array.from({ length: 300 }, (_, i) => `line ${i} of code`).join("\n");
  const html = `<pre><code class="language-python">${codeLines}</code></pre>`;
  const chunks = splitHtml(html);

  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0]).toMatch(/<\/code><\/pre>$/);
  expect(chunks[1]).toMatch(/^<pre><code class="language-python">/);
});

it("an overlong single line is force-cut outside tags", () => {
  const html = `<b>${"가".repeat(6000)}</b>`;
  const chunks = splitHtml(html);

  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(MAX_LENGTH);
    // every chunk must be self-contained tag-wise
    const opens = chunk.match(/<b>/g)?.length ?? 0;
    const closes = chunk.match(/<\/b>/g)?.length ?? 0;
    expect(opens).toBe(closes);
    expect(chunk).not.toMatch(/<$|<\/$|<b$/);
  }
});

it("force-cutting never splits an HTML entity", () => {
  const unit = "aa&amp;";
  const html = unit.repeat(1200);
  const chunks = splitHtml(html);
  for (const chunk of chunks) {
    expect(chunk).not.toMatch(/&a?m?p?$/);
  }
  expect(chunks.join("")).toBe(html);
});

it("the first chunk honors the 1024 caption limit", () => {
  const chunks = splitHtml("y".repeat(3000), CAPTION_MAX_LENGTH);
  expect(chunks[0]?.length).toBeLessThanOrEqual(CAPTION_MAX_LENGTH);
  expect(chunks.slice(1).join("").length).toBe(3000 - (chunks[0]?.length ?? 0));
});
