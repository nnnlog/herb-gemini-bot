import TelegramBot from "node-telegram-bot-api";
import { Readable } from "stream";
import { ConversationTurn } from "./db.js";
import { Content, Part } from "@google/genai";

// --- 타입 정의 ---
// Telegram에서 받은 파일 정보를 Attachment 타입으로 정규화하기 위한 인터페이스
interface TelegramFile {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_name?: string;
}

interface BuildContentsResult {
    contents: Content[];
    totalSize: number;
}

// --- 상수 ---
const imageCache = new Map<string, Buffer>();
const CACHE_MAX_SIZE = 100;
const mimeMap: { [key: string]: string } = {
    'pdf': 'application/pdf', 'py': 'text/x-python', 'js': 'text/javascript',
    'ts': 'text/typescript', 'java': 'text/x-java-source', 'c': 'text/x-c',
    'cpp': 'text/x-c++', 'cs': 'text/x-csharp', 'swift': 'text/x-swift',
    'php': 'text/x-php', 'rb': 'text/x-ruby', 'kt': 'text/x-kotlin',
    'go': 'text/x-go', 'rs': 'text/rust', 'html': 'text/html', 'css': 'text/css',
};

// --- 내부 헬퍼 함수 ---
function streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

function getMimeType(fileName: string = ''): string {
    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png')) return 'image/jpeg';
    const extension = fileName.split('.').pop()?.toLowerCase();
    return mimeMap[extension!] || 'application/octet-stream';
}

async function createFileParts(bot: TelegramBot, files: TelegramFile[]): Promise<Part[]> {
    if (!files || files.length === 0) {
        return [];
    }
    return Promise.all(files.map(async (file) => {
        const buffer = await getFileBuffer(bot, file.file_id);
        const mimeType = getMimeType(file.file_name);
        return { inlineData: { data: buffer.toString('base64'), mimeType } };
    }));
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

export async function buildContents(bot: TelegramBot, conversationHistory: ConversationTurn[], commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[], commandName: string): Promise<BuildContentsResult> {
    let totalSize = 0;

    const contents: Content[] = await Promise.all(
        conversationHistory.map(async (turn) => {
            turn.files.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, turn.files);
            const parts: Part[] = [...fileParts];
            const commandRegex = new RegExp(`^/${commandName}(?:@\\w+bot)?\\s*`);
            const cleanText = turn.text.replace(commandRegex, '').trim();
            if (cleanText) {
                parts.push({ text: cleanText });
            }
            return { role: turn.role, parts };
        })
    );

    const allMessages = [commandMsg, ...albumMessages];
    if (allMessages.length > 0 && contents.length > 0) {
        const historyFileIds = new Set(conversationHistory.flatMap(turn => turn.files.map(f => f.file_id)));

        const currentFiles: TelegramFile[] = allMessages
            .flatMap(m => (m.photo ? [{...m.photo[m.photo.length - 1], file_name: 'image.jpg'}] : (m.document ? [m.document] : [])))
            .filter((f): f is TelegramFile => !!(f && f.file_id && !historyFileIds.has(f.file_id)));

        if (currentFiles.length > 0) {
            currentFiles.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, currentFiles);
            const lastContent = contents[contents.length - 1];
            lastContent?.parts?.unshift(...fileParts);
        }
    }
    return { contents, totalSize };
}

export async function sendLongMessage(bot: TelegramBot, chatId: number, text: string, replyToId?: number): Promise<TelegramBot.Message> {
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
        return bot.sendMessage(chatId, text, { reply_to_message_id: replyToId, parse_mode: 'HTML' });
    }

    const chunks: string[] = [];
    let currentChunk = "";
    let inPreBlock = false;
    const lines = text.split('\n');

    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
            if (inPreBlock) {
                currentChunk += '\n</pre>';
            }
            chunks.push(currentChunk);
            currentChunk = inPreBlock ? '<pre>' : '';
        }

        if (line.includes('<pre>')) inPreBlock = true;
        currentChunk += line + '\n';
        if (line.includes('</pre>')) inPreBlock = false;
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    let currentReplyToId: number | undefined = replyToId;
    let lastSentMessage: TelegramBot.Message | null = null;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const sentMsg = await bot.sendMessage(chatId, chunk, {
            reply_to_message_id: currentReplyToId,
            parse_mode: 'HTML'
        });
        currentReplyToId = sentMsg.message_id;
        lastSentMessage = sentMsg;
    }
    return lastSentMessage!;
}