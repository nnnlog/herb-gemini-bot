import { expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const validEnv = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  GOOGLE_API_KEY: "key",
  GEMINI_PRO_MODEL: "gemini-pro-x",
  IMAGE_MODEL_NAME: "gemini-image-x",
  ALLOWED_CHANNEL_IDS: " -100123 , -100456 ",
  TRUSTED_USER_IDS: "42",
};

it("parses valid env into typed config, trimming whitespace", () => {
  const config = loadConfig(validEnv);
  expect(config.models.pro).toBe("gemini-pro-x");
  expect(config.models.image).toBe("gemini-image-x");
  expect(config.allowedChannelIds).toEqual(new Set([-100123, -100456]));
  expect(config.trustedUserIds).toEqual(new Set([42]));
});

it("empty whitelists become empty sets", () => {
  const config = loadConfig({ ...validEnv, ALLOWED_CHANNEL_IDS: "", TRUSTED_USER_IDS: undefined });
  expect(config.allowedChannelIds.size).toBe(0);
  expect(config.trustedUserIds.size).toBe(0);
});

it("reports every missing required variable at once", () => {
  try {
    loadConfig({ ALLOWED_CHANNEL_IDS: "1" });
    expect.unreachable();
  } catch (e) {
    const error = e as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain("TELEGRAM_BOT_TOKEN");
    expect(error.message).toContain("GOOGLE_API_KEY");
    expect(error.message).toContain("GEMINI_PRO_MODEL");
    expect(error.message).toContain("IMAGE_MODEL_NAME");
  }
});

it("rejects non-integer ids", () => {
  expect(() => loadConfig({ ...validEnv, TRUSTED_USER_IDS: "abc" })).toThrow(/TRUSTED_USER_IDS/);
});
