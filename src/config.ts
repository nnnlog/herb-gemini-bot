export interface Config {
  readonly telegramToken: string;
  readonly googleApiKey: string;
  readonly models: {
    readonly pro: string;
    readonly image: string;
  };
  readonly allowedChannelIds: ReadonlySet<number>;
  readonly trustedUserIds: ReadonlySet<number>;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`환경 변수 오류:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name}이(가) 설정되지 않았습니다.`);
    return value ?? "";
  };

  const idSet = (name: string): ReadonlySet<number> => {
    const ids = new Set<number>();
    for (const token of (env[name] ?? "").split(",")) {
      const trimmed = token.trim();
      if (trimmed === "") continue;
      const id = Number(trimmed);
      if (!Number.isInteger(id)) {
        problems.push(`${name}의 '${trimmed}'은(는) 정수 ID가 아닙니다.`);
        continue;
      }
      ids.add(id);
    }
    return ids;
  };

  const config: Config = {
    telegramToken: required("TELEGRAM_BOT_TOKEN"),
    googleApiKey: required("GOOGLE_API_KEY"),
    models: {
      pro: required("GEMINI_PRO_MODEL"),
      image: required("IMAGE_MODEL_NAME"),
    },
    allowedChannelIds: idSet("ALLOWED_CHANNEL_IDS"),
    trustedUserIds: idSet("TRUSTED_USER_IDS"),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
