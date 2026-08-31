import { expect, it } from "vitest";
import { parseCommand, parseParams, stripOwnCommand } from "../../src/commands/parse.ts";
import { findCommand } from "../../src/commands/specs.ts";

const BOT = "MyTestBot";

it("names and aliases both match, longest first", () => {
  expect(parseCommand("/gemini 안녕", BOT)?.spec.name).toBe("gemini");
  expect(parseCommand("/g 안녕", BOT)?.spec.name).toBe("gemini");
  expect(parseCommand("/IMG 그림", BOT)?.spec.name).toBe("image");
  expect(parseCommand("/gemini 안녕", BOT)?.rest).toBe("안녕");
});

it("handles mentions of this bot and ignores other bots", () => {
  expect(parseCommand("/gemini@mytestbot 질문", BOT)?.spec.name).toBe("gemini");
  expect(parseCommand("/gemini@OtherBot 질문", BOT)).toBeUndefined();
});

it("prefix look-alikes are not commands", () => {
  expect(parseCommand("/geminix", BOT)).toBeUndefined();
  expect(parseCommand("gemini 없이", BOT)).toBeUndefined();
});

it("rest preserves inner newlines", () => {
  expect(parseCommand("/gemini  첫줄\n둘째줄", BOT)?.rest).toBe("첫줄\n둘째줄");
});

const imageSpec = findCommand("image");
if (!imageSpec) throw new Error("image spec missing");

it("the resolution token is consumed once, anywhere, case-insensitively", () => {
  const { args, cleanedText } = parseParams("make a 4K tv", imageSpec);
  expect(args.resolution).toBe("4k");
  expect(cleanedText).toBe("make a tv");
});

it("token removal preserves newlines", () => {
  const { cleanedText } = parseParams("첫 줄 2k\n둘째 줄", imageSpec);
  expect(cleanedText).toBe("첫 줄\n둘째 줄");
});

it("a missing token falls back to the default and leaves text intact", () => {
  const { args, cleanedText } = parseParams("21k 모니터 그림", imageSpec);
  expect(args.resolution).toBe("1k"); // "21k" is not a token
  expect(cleanedText).toBe("21k 모니터 그림");
});

it("history stripping uses each turn's own command, not the running one", () => {
  expect(stripOwnCommand("/img 2k 고양이 그림")).toBe("고양이 그림");
  expect(stripOwnCommand("/image@MyTestBot 고양이")).toBe("고양이");
  // a turn from another command loses that command's prefix, not this one's
  expect(stripOwnCommand("/map 어디야")).toBe("어디야");
  // a word that only looks like another command's param token survives
  expect(stripOwnCommand("/gemini 2k 모니터 추천")).toBe("2k 모니터 추천");
  expect(stripOwnCommand("명령어 없는 본문")).toBe("명령어 없는 본문");
});
