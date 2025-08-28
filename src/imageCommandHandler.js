import { isUserAuthorized } from './auth.js';
import { generateFromHistory } from './aiHandler.js';
import { logMessage, getConversationHistory } from './db.js';
import { marked } from 'marked';

const imageCache = new Map();
const CACHE_MAX_SIZE = 100;
const mediaGroupCache = new Map();

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

async function handleImageCommand(commandMsg, albumMessages = [], bot, BOT_ID, config) {
    const chatId = commandMsg.chat.id;

    try {
        const conversationHistory = await getConversationHistory(chatId, commandMsg);

        let contents = await Promise.all(
            conversationHistory.map(async (turn) => {
                const parts = [];
                // 각 턴에 포함된 이미지 파일 처리
                for (const fileId of turn.imageFileIds) {
                    const imageBuffer = await getPhotoBuffer(bot, fileId);
                    parts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } });
                }
                // 각 턴의 텍스트 처리
                const commandRegex = /^\/image(?:@\w+bot)?\s*/;
                const cleanText = turn.text.replace(commandRegex, '').trim();
                if (cleanText) parts.push({ text: cleanText });
                return { role: turn.role, parts };
            })
        );

        // 앨범으로 함께 전송된 사진들을 마지막 턴에 추가합니다.
        // conversationHistory에 이미 포함된 사진은 중복 추가하지 않습니다.
        if (albumMessages.length > 0 && contents.length > 0) {
            const historyFileIds = new Set(conversationHistory.flatMap(turn => turn.imageFileIds));
            const albumFileIds = albumMessages
                .map(m => m.photo ? m.photo[m.photo.length - 1].file_id : null)
                .filter(id => id && !historyFileIds.has(id)); // 중복 제외

            if (albumFileIds.length > 0) {
                const imageParts = await Promise.all(albumFileIds.map(async fileId => {
                    const imageBuffer = await getPhotoBuffer(bot, fileId);
                    return { inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } };
                }));
                const lastTurn = contents[contents.length - 1];
                lastTurn.parts = [...imageParts, ...lastTurn.parts];
            }
        }

        // parts가 비어있는 비유효 턴을 제거하되, 사용자의 마지막 프롬프트(명령어) 턴은 유지합니다.
        contents = contents.filter((turn, index) => turn.parts.length > 0 || index === contents.length - 1);

        if (contents.length === 0) {
             const sentMsg = await bot.sendMessage(chatId, "⚠️ 프롬프트로 삼을 유효한 메시지가 없습니다.", { reply_to_message_id: commandMsg.message_id });
             logMessage(sentMsg, BOT_ID, 'image');
             return;
        }

        const request = {
            contents: contents,
            config: {},
        };
        const result = await generateFromHistory(config.imageModelName, request, config.googleApiKey);

        if (result.error) {
            console.error(`[MODEL_ERROR] ChatID(${chatId}):`, result.error);
            const sentMsg = await bot.sendMessage(chatId, `😥 생성 실패: ${result.error}`, { reply_to_message_id: commandMsg.message_id });
            logMessage(sentMsg, BOT_ID, 'image');
        } else if (result.text) {
            console.log(`[MODEL_TEXT] ChatID(${chatId}):`, result.text);
            const message = `*모델 응답:*\n\n${result.text}`;
            const sentMsg = await bot.sendMessage(chatId, marked.parseInline(message), { reply_to_message_id: commandMsg.message_id, parse_mode: 'HTML' });
            logMessage(sentMsg, BOT_ID, 'image');
        } else if (result.images && result.images.length > 0) {
            if (result.images.length > 1) {
                const media = result.images.map(img => ({ type: 'photo', media: img.buffer }));
                const sentMessages = await bot.sendMediaGroup(chatId, media, { reply_to_message_id: commandMsg.message_id });
                sentMessages.forEach(sentMsg => logMessage(sentMsg, BOT_ID, 'image'));
            } else {
                const sentMsg = await bot.sendPhoto(chatId, result.images[0].buffer, { reply_to_message_id: commandMsg.message_id });
                logMessage(sentMsg, BOT_ID, 'image');
            }
            console.log(`성공: 사용자(ID: ${commandMsg.from.id})에게 ${result.images.length}개의 콘텐츠 전송 완료.`);
        }
    } catch (error) {
        console.error("이미지 명령어 처리 중 오류:", error);
        const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", { reply_to_message_id: commandMsg.message_id });
        logMessage(sentMsg, BOT_ID, 'image');
    }
}

function processAlbum(group, bot, BOT_ID, config) {
    const commandMsgTemplate = group.messages.find(m => m.caption?.startsWith('/image')) || group.messages[0];
    const replyToId = commandMsgTemplate.message_id;
    console.log(`앨범 ${commandMsgTemplate.media_group_id} 처리 시작 (${group.messages.length}개 사진)`);
    handleImageCommand(commandMsgTemplate, group.messages, bot, BOT_ID, config, replyToId);
}

export async function processImageCommand(msg, bot, BOT_ID, config) {
    if (!isUserAuthorized(msg.chat.id, msg.from.id)) {
        const sentMsg = await bot.sendMessage(msg.chat.id, "죄송합니다. 이 기능을 사용할 권한이 없습니다.", { reply_to_message_id: msg.message_id });
        logMessage(sentMsg, BOT_ID);
        return;
    }

    const text = msg.text || msg.caption || '';
    const commandOnlyRegex = /^\/image(?:@\w+bot)?\s*$/;
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

    if (msg.media_group_id) {
        if (!mediaGroupCache.has(msg.media_group_id)) {
            mediaGroupCache.set(msg.media_group_id, { messages: [] });
        }
        const group = mediaGroupCache.get(msg.media_group_id);
        group.messages.push(msg);
        if (group.timer) clearTimeout(group.timer);
        group.timer = setTimeout(() => {
            processAlbum(group, bot, BOT_ID, config);
            mediaGroupCache.delete(msg.media_group_id);
        }, 1500);
    } else {
        const replyToId = msg.message_id;
        let promptSourceMsg = msg;

        const originalMsg = msg.reply_to_message;

        // 명령어만 있고, 메시지 자체에 사진/문서가 없으며, 다른 사용자의 메시지에 대한 답장일 때
        if (commandOnlyRegex.test(text) && !msg.photo && !msg.document && originalMsg && originalMsg.from.id !== BOT_ID) {
            const isValidTarget = originalMsg.text || originalMsg.caption || originalMsg.photo || originalMsg.document || originalMsg.forward_from || originalMsg.forward_from_chat;
            if (isValidTarget) {
                console.log(`[image] 암시적 프롬프트 감지: 원본 메시지를 프롬프트 소스로 사용합니다.`);
                promptSourceMsg = originalMsg;
            }
        }

        await handleImageCommand(promptSourceMsg, [], bot, BOT_ID, config, replyToId);
    }
}