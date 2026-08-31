import type { Token, Tokens } from "marked";
import { lexer } from "marked";

// Untrusted text (model output, user echoes) passes through this escape exactly once.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Entities Telegram resolves back to their character. Anything outside this set keeps the
// literal-ampersand treatment, so an entity Telegram might reject is never emitted raw.
const RESOLVED_ENTITY = /&(?!(?:amp|lt|gt|quot|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

/**
 * Escape prose. Markdown resolves entity references in text (but not in code), so an
 * `&amp;` the model wrote is already the character `&` and must not be escaped twice.
 */
function escapeProse(text: string): string {
  return text.replace(RESOLVED_ENTITY, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

// Telegram rejects a whole message whose anchor carries any other scheme.
const SUPPORTED_SCHEME = /^(?:https?|tg):\/\//i;

/** An href Telegram accepts, or undefined when the link must render as plain text. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  return SUPPORTED_SCHEME.test(trimmed) ? trimmed : undefined;
}

/** Markdown → Telegram HTML. marked is a tokenizer only; all emission happens here. */
export function markdownToTelegramHtml(markdown: string): string {
  return collapseBlankLines(renderBlocks(lexer(markdown))).trim();
}

/** Blank-line collapsing skips <pre> spans, whose content is reproduced verbatim. */
function collapseBlankLines(html: string): string {
  let out = "";
  let index = 0;
  for (;;) {
    const start = html.indexOf("<pre>", index);
    if (start === -1) break;
    const end = html.indexOf("</pre>", start);
    if (end === -1) break;
    out += html.slice(index, start).replace(/\n{3,}/g, "\n\n") + html.slice(start, end + 6);
    index = end + 6;
  }
  return out + html.slice(index).replace(/\n{3,}/g, "\n\n");
}

function renderBlocks(tokens: Token[]): string {
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        out += `<b>${renderInline((token as Tokens.Heading).tokens)}</b>\n\n`;
        break;
      case "paragraph":
        out += `${renderInline((token as Tokens.Paragraph).tokens)}\n\n`;
        break;
      case "code": {
        const code = token as Tokens.Code;
        const cls = code.lang ? ` class="language-${escapeAttribute(code.lang)}"` : "";
        out += `<pre><code${cls}>${escapeHtml(code.text)}</code></pre>\n\n`;
        break;
      }
      case "blockquote":
        out += `<blockquote>${renderBlocks((token as Tokens.Blockquote).tokens).trim()}</blockquote>\n\n`;
        break;
      case "list":
        out += `${renderList(token as Tokens.List, 0)}\n`;
        break;
      case "table":
        // Telegram HTML has no tables — preserve raw rows as monospace
        out += `<pre>${escapeHtml((token as Tokens.Table).raw.trim())}</pre>\n\n`;
        break;
      case "hr":
        out += "———\n\n";
        break;
      case "space":
      case "def":
        break;
      case "html":
        out += `${escapeHtml((token as Tokens.HTML).text)}\n\n`;
        break;
      case "text": {
        const text = token as Tokens.Text;
        out += `${text.tokens ? renderInline(text.tokens) : escapeProse(text.text)}\n\n`;
        break;
      }
      default:
        out += `${escapeHtml(rawOf(token))}\n\n`;
    }
  }
  return out;
}

function renderList(list: Tokens.List, depth: number): string {
  const indent = "  ".repeat(depth);
  let out = "";
  let n = typeof list.start === "number" ? list.start : 1;
  for (const item of list.items) {
    let marker = list.ordered ? `${n}. ` : "• ";
    n += 1;
    if (item.task) marker += item.checked ? "☑ " : "☐ ";

    const lineParts: string[] = [];
    let nested = "";
    for (const child of item.tokens) {
      switch (child.type) {
        case "list":
          nested += renderList(child as Tokens.List, depth + 1);
          break;
        case "text": {
          const text = child as Tokens.Text;
          lineParts.push(text.tokens ? renderInline(text.tokens) : escapeProse(text.text));
          break;
        }
        case "paragraph":
          lineParts.push(renderInline((child as Tokens.Paragraph).tokens));
          break;
        case "code": {
          const code = child as Tokens.Code;
          const cls = code.lang ? ` class="language-${escapeAttribute(code.lang)}"` : "";
          nested += `${indent}<pre><code${cls}>${escapeHtml(code.text)}</code></pre>\n`;
          break;
        }
        case "space":
        case "checkbox": // the ☑/☐ marker above already carries it
          break;
        default:
          lineParts.push(escapeHtml(rawOf(child)));
      }
    }
    out += `${indent}${marker}${lineParts.join(" ").trim()}\n`;
    out += nested;
  }
  return out;
}

function renderInline(tokens: Token[]): string {
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        out += escapeProse((token as Tokens.Text).text);
        break;
      case "escape":
        out += escapeHtml((token as Tokens.Escape).text);
        break;
      case "strong":
        out += `<b>${renderInline((token as Tokens.Strong).tokens)}</b>`;
        break;
      case "em":
        out += `<i>${renderInline((token as Tokens.Em).tokens)}</i>`;
        break;
      case "del":
        out += `<s>${renderInline((token as Tokens.Del).tokens)}</s>`;
        break;
      case "codespan":
        out += `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`;
        break;
      case "link": {
        const link = token as Tokens.Link;
        const href = safeHref(link.href);
        const label = renderInline(link.tokens);
        out += href ? `<a href="${escapeAttribute(href)}">${label}</a>` : label;
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        const href = safeHref(image.href);
        const label = escapeHtml(image.text || image.href);
        out += href ? `<a href="${escapeAttribute(href)}">${label}</a>` : label;
        break;
      }
      case "br":
        out += "\n";
        break;
      case "html":
        out += escapeHtml((token as Tokens.HTML).text);
        break;
      default:
        out += escapeHtml(rawOf(token));
    }
  }
  return out;
}

function rawOf(token: Token): string {
  return "raw" in token && typeof token.raw === "string" ? token.raw : "";
}
