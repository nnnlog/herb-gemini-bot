import { expect, it } from "vitest";
import { escapeHtml, markdownToTelegramHtml } from "../../src/render/markdown.ts";

it("headings become bold lines (Telegram has no heading tag)", () => {
  expect(markdownToTelegramHtml("### 제목 *강조*")).toBe("<b>제목 <i>강조</i></b>");
});

it("raw HTML in prose is escaped as text", () => {
  expect(markdownToTelegramHtml("type is <div> & <span>")).toBe(
    "type is &lt;div&gt; &amp; &lt;span&gt;",
  );
});

it("fenced code blocks get a language class and escaped content", () => {
  const out = markdownToTelegramHtml('```html\n<div class="x">&nbsp;</div>\n```');
  expect(out).toBe(
    '<pre><code class="language-html">&lt;div class="x"&gt;&amp;nbsp;&lt;/div&gt;</code></pre>',
  );
});

it("inline formatting maps to Telegram tags", () => {
  expect(markdownToTelegramHtml("**b** *i* ~~s~~ `c <x>` [링크](https://a.b)")).toBe(
    '<b>b</b> <i>i</i> <s>s</s> <code>c &lt;x&gt;</code> <a href="https://a.b">링크</a>',
  );
});

it("nested lists render as bullets and numbers with indentation", () => {
  const out = markdownToTelegramHtml("- one **b**\n  - nested\n- two\n\n1. first\n2. second");
  expect(out).toBe("• one <b>b</b>\n  • nested\n• two\n\n1. first\n2. second");
});

it("summarize-style output (### plus bullets) renders as formatting, not literals", () => {
  const out = markdownToTelegramHtml("### 핵심 사항\n- **금리:** 인상\n- **배경:** 물가");
  expect(out).toBe("<b>핵심 사항</b>\n\n• <b>금리:</b> 인상\n• <b>배경:</b> 물가");
});

it("tables are preserved raw in a monospace block", () => {
  const out = markdownToTelegramHtml("| a | b |\n|---|---|\n| 1 | 2 |");
  expect(out).toBe("<pre>| a | b |\n|---|---|\n| 1 | 2 |</pre>");
});

it("handles horizontal rules and escape characters", () => {
  expect(markdownToTelegramHtml("위\n\n---\n\n아래 \\* 별")).toBe("위\n\n———\n\n아래 * 별");
});

it("blockquotes become blockquote tags", () => {
  expect(markdownToTelegramHtml("> 인용 <태그>")).toBe(
    "<blockquote>인용 &lt;태그&gt;</blockquote>",
  );
});

it("escapeHtml replaces only &, <, and >", () => {
  expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
});
