import {Content, Part} from "@google/genai";
import TelegramBot from "node-telegram-bot-api";
import {Readable} from "stream";
import {ConversationTurn} from "../services/db.js";

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

export interface ImageData {
    buffer: Buffer;
    mimeType: string;
}

// --- 상수 ---
const imageCache = new Map<string, Buffer>();
const CACHE_MAX_SIZE = 100;
const mimeMap: {[key: string]: string} = {
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
        return {inlineData: {data: buffer.toString('base64'), mimeType}};
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
            // 만약 DB에 저장된 원본 parts(thought_signature 포함)가 있다면 그것을 우선 사용
            if (turn.parts && turn.parts.length > 0) {
                let parts = turn.parts;

                // image 명령어인 경우 functionCall과 functionResponse 부분 제거
                if (commandName === 'image') {
                    parts = parts.filter(part =>
                        !('functionCall' in part) && !('functionResponse' in part)
                    );
                }

                return {role: turn.role, parts};
            }

            turn.files.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, turn.files);
            const parts: Part[] = [...fileParts];
            const commandRegex = new RegExp(`^/${commandName}(?:@\\w+bot)?\\s*`);
            const cleanText = turn.text.replace(commandRegex, '').trim();
            if (cleanText) {
                parts.push({text: cleanText});
            }
            return {role: turn.role, parts};
        })
    );

    const allMessages = [commandMsg, ...albumMessages];
    if (allMessages.length > 0 && contents.length > 0) {
        const historyFileIds = new Set(conversationHistory.flatMap(turn => turn.files.map(f => f.file_id)));

        const currentFiles: TelegramFile[] = allMessages
            .flatMap(m => (m.photo ? [{
                ...m.photo[m.photo.length - 1],
                file_name: 'image.jpg'
            }] : (m.document ? [m.document] : [])))
            .filter((f): f is TelegramFile => !!(f && f.file_id && !historyFileIds.has(f.file_id)));

        if (currentFiles.length > 0) {
            currentFiles.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, currentFiles);
            const lastContent = contents[contents.length - 1];
            lastContent?.parts?.unshift(...fileParts);
        }
    }
    return {contents, totalSize};
}

export async function sendLongMessage(bot: TelegramBot, chatId: number, text: string, replyToId?: number, images?: ImageData[]): Promise<TelegramBot.Message> {
    const MAX_LENGTH = 4096;
    const CAPTION_MAX_LENGTH = 1024;

    // 텍스트가 짧고 이미지가 없는 경우: 단순 전송
    if (text.length <= MAX_LENGTH && (!images || images.length === 0)) {
        return bot.sendMessage(chatId, text, {reply_to_message_id: replyToId, parse_mode: 'HTML'});
    }

    // 텍스트 분할 - 이미지가 있으면 첫 청크는 caption 길이 제한 적용
    const chunks: string[] = [];
    let currentChunk = "";
    let inPreBlock = false;
    const lines = text.split('\n');
    const firstChunkMaxLength = (images && images.length > 0) ? CAPTION_MAX_LENGTH : MAX_LENGTH;

    for (const line of lines) {
        const maxLength = chunks.length === 0 ? firstChunkMaxLength : MAX_LENGTH;

        if (currentChunk.length + line.length + 1 > maxLength) {
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

    // 첫 번째 메시지 전송 (이미지 포함 여부에 따라 분기)
    let firstMessage: TelegramBot.Message;
    const firstChunk = chunks[0] || '';

    if (images && images.length > 0) {
        const hasCaption = firstChunk.trim().length > 0;

        if (images.length === 1) {
            // 단일 이미지: sendPhoto
            const options: any = {reply_to_message_id: replyToId};
            if (hasCaption) {
                options.caption = firstChunk;
                options.parse_mode = 'HTML';
            }
            firstMessage = await bot.sendPhoto(chatId, images[0].buffer, options);
        } else {
            // 다중 이미지: sendMediaGroup
            const mediaGroup: TelegramBot.InputMediaPhoto[] = images.map((img, index) => ({
                type: 'photo',
                media: img.buffer as any,
                caption: (index === 0 && hasCaption) ? firstChunk : undefined,
                parse_mode: (index === 0 && hasCaption) ? 'HTML' : undefined
            }));
            const sentMessages = await bot.sendMediaGroup(chatId, mediaGroup, {
                reply_to_message_id: replyToId
            });
            firstMessage = sentMessages[0];
        }
    } else {
        // 이미지 없음: 일반 메시지
        firstMessage = await bot.sendMessage(chatId, firstChunk, {
            reply_to_message_id: replyToId,
            parse_mode: 'HTML'
        });
    }

    // 나머지 청크 전송 (텍스트만)
    let currentReplyToId = firstMessage.message_id;
    let lastSentMessage = firstMessage;

    for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        const sentMsg = await bot.sendMessage(chatId, chunk, {
            reply_to_message_id: currentReplyToId,
            parse_mode: 'HTML'
        });
        currentReplyToId = sentMsg.message_id;
        lastSentMessage = sentMsg;
    }

    return lastSentMessage;
}