import { isUserAuthorized } from './auth.js';
import { generateFromHistory } from './aiHandler.js';
import { logMessage, getConversationHistory } from './db.js';

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
        const conversationHistory = await getConversationHistory(chatId, commandMsg.message_id);
        const allImageFileIds = new Set();
        conversationHistory.forEach(turn => turn.imageFileIds.forEach(id => allImageFileIds.add(id)));
        albumMessages.forEach(msg => {
            if (msg.photo) allImageFileIds.add(msg.photo[msg.photo.length - 1].file_id);
        });

        const contents = await Promise.all(
            conversationHistory.map(async (turn) => {
                const parts = [];
                const commandRegex = /^\/image(?:@\w+bot)?\s*/;
                const cleanText = turn.text.replace(commandRegex, '').trim();
                if (cleanText) parts.push({ text: cleanText });
                return { role: turn.role, parts };
            })
        );

        if (allImageFileIds.size > 0 && contents.length > 0) {
            const imageParts = [];
            for (const fileId of allImageFileIds) {
                const imageBuffer = await getPhotoBuffer(bot, fileId);
                imageParts.push({ inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } });
            }
            const lastTurn = contents[contents.length - 1];
            lastTurn.parts = [...imageParts, ...lastTurn.parts];
        }

        const lastTurn = contents.length > 0 ? contents[contents.length - 1] : { parts: [] };
        const hasTextInLastTurn = lastTurn.parts.some(p => p.text);
        if (!hasTextInLastTurn && allImageFileIds.size === 0) {
             const sentMsg = await bot.sendMessage(chatId, "⚠️ 프롬프트가 비어있습니다.", { reply_to_message_id: commandMsg.message_id });
             logMessage(sentMsg, BOT_ID, 'image');
             return;
        }

        const request = {
            contents: contents,
            config: {
                // 이미지 생성 시에는 특별한 도구나 설정이 없으므로 비워둠
            },
        };
        const result = await generateFromHistory(config.imageModelName, request, config.googleApiKey);

        if (result.error) {
            console.error(`[MODEL_ERROR] ChatID(${chatId}):`, result.error);
            const sentMsg = await bot.sendMessage(chatId, `😥 생성 실패: ${result.error}`, { reply_to_message_id: commandMsg.message_id });
            logMessage(sentMsg, BOT_ID, 'image');
        } else if (result.text) {
            console.log(`[MODEL_TEXT] ChatID(${chatId}):`, result.text);
            const message = `*모델 응답:*\n\n${result.text}`;
            const sentMsg = await bot.sendMessage(chatId, message, { reply_to_message_id: commandMsg.message_id, parse_mode: 'Markdown' });
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
    const commandMsg = group.messages.find(m => m.caption?.startsWith('/image')) || group.messages[0];
    console.log(`앨범 ${commandMsg.media_group_id} 처리 시작 (${group.messages.length}개 사진)`);
    handleImageCommand(commandMsg, group.messages, bot, BOT_ID, config);
}

export async function processImageCommand(msg, bot, BOT_ID, config) {
    if (!isUserAuthorized(msg.chat.id, msg.from.id)) {
        const sentMsg = await bot.sendMessage(msg.chat.id, "죄송합니다. 이 기능을 사용할 권한이 없습니다.", { reply_to_message_id: msg.message_id });
        logMessage(sentMsg, BOT_ID);
        return;
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
        handleImageCommand(msg, [], bot, BOT_ID, config);
    }
}