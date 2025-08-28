import dotenv from 'dotenv';
dotenv.config();

export interface Config {
    telegramToken: string | undefined;
    googleApiKey: string | undefined;
    imageModelName: string | undefined;
    geminiProModel: string | undefined;
    allowedChannelIds: string[];
    trustedUserIds: string[];
}

export const config: Config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    googleApiKey: process.env.GOOGLE_API_KEY,
    imageModelName: process.env.IMAGE_MODEL_NAME,
    geminiProModel: process.env.GEMINI_PRO_MODEL,
    allowedChannelIds: process.env.ALLOWED_CHANNEL_IDS?.split(',') || [],
    trustedUserIds: process.env.TRUSTED_USER_IDS?.split(',') || [],
};

if (!config.telegramToken || !config.googleApiKey) {
    console.error("오류: TELEGRAM_BOT_TOKEN 또는 GOOGLE_API_KEY가 .env 파일에 설정되지 않았습니다.");
    process.exit(1);
}