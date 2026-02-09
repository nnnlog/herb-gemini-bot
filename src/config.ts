import dotenv from 'dotenv';

dotenv.config();

export interface Config {
    telegramToken: string;
    googleApiKey: string;
    imageModelName: string;
    geminiProModel: string;
    allowedChannelIds: string[];
    trustedUserIds: string[];
}

export const config: Config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN as string,
    googleApiKey: process.env.GOOGLE_API_KEY as string,
    imageModelName: process.env.IMAGE_MODEL_NAME as string,
    geminiProModel: process.env.GEMINI_PRO_MODEL as string,
    allowedChannelIds: (process.env.ALLOWED_CHANNEL_IDS as string).split(','),
    trustedUserIds: (process.env.TRUSTED_USER_IDS as string).split(','),
};

if (!config.telegramToken || !config.googleApiKey) {
    console.error("오류: TELEGRAM_BOT_TOKEN 또는 GOOGLE_API_KEY가 .env 파일에 설정되지 않았습니다.");
    process.exit(1);
}