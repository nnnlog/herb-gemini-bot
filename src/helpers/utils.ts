import TelegramBot from "node-telegram-bot-api";
import {Readable} from "stream";

// --- 상수 ---
const imageCache = new Map<string, Buffer>();
const CACHE_MAX_SIZE = 100;

// --- 내부 헬퍼 함수 ---
function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

// --- 내보낼 함수 --- //
export async function getFileBuffer(bot: TelegramBot, fileId: string): Promise<Buffer> {
    if (imageCache.has(fileId)) {
        return imageCache.get(fileId)!;
    }
    const fileStream = bot.getFileStream(fileId);
    const buffer = await streamToBuffer(fileStream);
    if (imageCache.size >= CACHE_MAX_SIZE) {
        const oldestKey = imageCache.keys().next().value;
        if (oldestKey) {
            imageCache.delete(oldestKey);
        }
    }
    imageCache.set(fileId, buffer);
    return buffer;
}