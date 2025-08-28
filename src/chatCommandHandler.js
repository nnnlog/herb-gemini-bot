import { isUserAuthorized } from './auth.js';
import { generateFromHistory } from './aiHandler.js';
import { logMessage, getConversationHistory } from './db.js';
import { marked } from 'marked';

const imageCache = new Map();
const CACHE_MAX_SIZE = 100;

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function getPhotoBuffer(bot, fileId) {
    if (imageCache.has(fileId)) {
        return imageCache.get(fileId);
    }
    const fileStream = bot.getFileStream(fileId);
    const buffer = await streamToBuffer(fileStream);
    if (imageCache.size >= CACHE_MAX_SIZE) {
        const oldestKey = imageCache.keys().next().value;
        imageCache.delete(oldestKey);
    }
    imageCache.set(fileId, buffer);
    return buffer;
}

async function handleChatCommand(commandMsg, bot, BOT_ID, config, replyToId) {
    const chatId = commandMsg.chat.id;
    try {
        const conversationHistory = await getConversationHistory(chatId, commandMsg);

        let contents = await Promise.all(
            conversationHistory.map(async (turn) => {
                const parts = [];
                for (const fileId of turn.imageFileIds) {
                    const imageBuffer = await getPhotoBuffer(bot, fileId);
                    parts.push({
                        inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' }
                    });
                }
                const commandRegex = /^\/gemini(?:@\w+bot)?\s*/;
                const cleanText = turn.text.replace(commandRegex, '').trim();
                if (cleanText) {
                    parts.push({ text: cleanText });
                }
                return { role: turn.role, parts };
            })
        );

        // parts가 비어있는 비유효 턴을 제거하되, 사용자의 마지막 프롬프트(명령어) 턴은 유지합니다.
        contents = contents.filter((turn, index) => turn.parts.length > 0 || index === contents.length - 1);

        if (contents.length === 0) {
            const sentMsg = await bot.sendMessage(chatId, "⚠️ 메시지가 비어있습니다.", { reply_to_message_id: replyToId });
            logMessage(sentMsg, BOT_ID, 'chat');
            return;
        }

        const tools = [
            { googleSearch: {} },
            { urlContext: {} },
            { codeExecution: {} },
        ];
        const httpOptions = {
            timeout: 120000,
        };
        const generationConfig = {
            thinkingConfig: {
                thinkingBudget: 32768,
            },
            tools: tools,
            httpOptions: httpOptions,
        };

        const request = {
            contents: contents,
            config: generationConfig,
        };

        const result = await generateFromHistory(config.geminiProModel, request, config.googleApiKey);

        if (result.error) {
            const sentMsg = await bot.sendMessage(chatId, `😥 응답 생성 실패: ${result.error}`, { reply_to_message_id: replyToId });
            logMessage(sentMsg, BOT_ID, 'chat');
        } else if (result.text) {
            const sentMsg = await bot.sendMessage(chatId, marked.parseInline(result.text), { reply_to_message_id: replyToId, parse_mode: 'HTML' });
            logMessage(sentMsg, BOT_ID, 'chat');
        } else {
             const sentMsg = await bot.sendMessage(chatId, "🤔 모델이 텍스트 응답을 생성하지 않았습니다.", { reply_to_message_id: replyToId });
             logMessage(sentMsg, BOT_ID, 'chat');
        }
    } catch (error) {
        console.error("채팅 명령어 처리 중 오류:", error);
        const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", { reply_to_message_id: replyToId });
        logMessage(sentMsg, BOT_ID, 'chat');
    }
}

export async function processChatCommand(msg, bot, BOT_ID, config) {
    if (!isUserAuthorized(msg.chat.id, msg.from.id)) {
        const sentMsg = await bot.sendMessage(msg.chat.id, "죄송합니다. 이 기능을 사용할 권한이 없습니다.", { reply_to_message_id: msg.message_id });
        logMessage(sentMsg, BOT_ID);
        return;
    }

    const text = msg.text || msg.caption || '';
    const commandOnlyRegex = /^\/gemini(?:@\w+bot)?\s*$/;
    const hasMedia = msg.photo || msg.document;

    // --- 프롬프트 예외 처리 시작 ---
    if (commandOnlyRegex.test(text) && !hasMedia) {
        const originalMsg = msg.reply_to_message;

        if (!originalMsg) {
            // 시나리오 A: 답장 없이 명령어만 보낸 경우
            const sentMsg = await bot.sendMessage(msg.chat.id, "⚠️ 명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID);
            return;
        }

        const isOriginalFromBot = originalMsg.from.id === BOT_ID;
        const hasOriginalMedia = originalMsg.photo || originalMsg.document;
        const anyCommandRegex = /^\/(gemini|image)(?:@\w+bot)?\s*$/;
        const isOriginalCommandOnly = anyCommandRegex.test(originalMsg.text || originalMsg.caption || '');

        if (isOriginalFromBot || (isOriginalCommandOnly && !hasOriginalMedia)) {
            // 시나리오 B: 봇의 응답이나 다른 명령어에 다시 명령어로 답장한 경우
            const sentMsg = await bot.sendMessage(msg.chat.id, "⚠️ 봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID);
            return;
        }
    }

    const replyToId = msg.message_id;
    let promptSourceMsg = msg;
    const originalMsg = msg.reply_to_message;

    // 명령어만 있고, 메시지 자체에 사진/문서가 없으며, 다른 사용자의 메시지에 대한 답장일 때
    if (commandOnlyRegex.test(text) && !msg.photo && !msg.document && originalMsg && originalMsg.from.id !== BOT_ID) {
        const isValidTarget = originalMsg.text || originalMsg.caption || originalMsg.photo || originalMsg.document || originalMsg.forward_from || originalMsg.forward_from_chat;

        if (isValidTarget) {
            console.log(`[gemini] 암시적 프롬프트 감지: 유효한 원본 메시지를 프롬프트 소스로 사용합니다.`);
            promptSourceMsg = originalMsg;
        }
    }

    await handleChatCommand(promptSourceMsg, bot, BOT_ID, config, replyToId);
}