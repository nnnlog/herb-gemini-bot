import { expect, it } from "vitest";
import {
  buildHelpDetail,
  buildHelpText,
  buildMenuCommands,
  buildStartText,
} from "../../src/commands/help.ts";

it("/start text has a greeting, the menu commands, and a hint", () => {
  const text = buildStartText();
  expect(
    text.startsWith("반갑습니다! Gemini AI 봇입니다. 🤖\n\n<b>사용 가능한 명령어:</b>\n"),
  ).toBe(true);
  expect(text).toContain("/gemini - Gemini 3.0 Pro 모델과 대화합니다.\n");
  expect(text).not.toContain("/start -");
  expect(text.endsWith("\n명령어를 입력하거나, 궁금한 점을 자연스럽게 물어보세요!")).toBe(true);
});

it("/help listing ends with the detail hint", () => {
  const text = buildHelpText();
  expect(text.startsWith("<b>사용 가능한 명령어:</b>\n\n")).toBe(true);
  expect(text.endsWith("\n/help [명령어] 를 입력하면 자세한 사용법을 볼 수 있습니다.")).toBe(true);
});

it("help detail shows aliases and params, including via alias lookup", () => {
  const detail = buildHelpDetail("img");
  expect(detail).toContain("<b>/image</b>\n");
  expect(detail).toContain("별칭: img\n");
  expect(detail).toContain("<b>매개변수:</b>\n");
  expect(detail).toContain("- resolution (string): 이미지 해상도 (기본값: 1k) [1k, 2k, 4k]");
});

it("unknown command lookups echo escaped input", () => {
  expect(buildHelpDetail("<b>x</b>")).toBe("알 수 없는 명령어입니다: &lt;b&gt;x&lt;/b&gt;");
});

it("the menu registers canonical names plus described aliases, excluding start", () => {
  const commands = buildMenuCommands();
  const names = commands.map((c) => c.command);

  expect(names).toEqual(["help", "gemini", "g", "image", "img", "map", "summarize"]);
  expect(commands.find((c) => c.command === "g")?.description).toBe(
    "/gemini의 별칭. Gemini 3.0 Pro 모델과 대화합니다.",
  );
});
