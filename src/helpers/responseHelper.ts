import {marked} from 'marked';
import TelegramBot, {InputMediaPhoto} from "node-telegram-bot-api";
import {GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';
import {sendLongMessage} from './utils.js';

export async function handleGeminiResponse(
    bot: TelegramBot,
    commandMsg: TelegramBot.Message,
    result: GenerationOutput,
    BOT_ID: number,
    replyToId: number,
    logType: 'chat' | 'image' | 'map' | 'summarize' = 'chat'
) {
    const chatId = commandMsg.chat.id;

    // 1. 에러 처리
    if (result.error) {
        console.error(`[MODEL_ERROR] ChatID(${chatId}):`, result.error);
        const sentMsg = await bot.sendMessage(chatId, `응답 생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
        logMessage(sentMsg, BOT_ID, 'error');
        return;
    }

    const hasText = result.text && result.text.length > 0;
    const hasImages = result.images && result.images.length > 0;

    // 2. 이미지 처리
    if (hasImages) {
        const caption = hasText ? marked.parseInline(result.text!) as string : undefined;

        if (result.images!.length > 1) {
            // 1. 앨범(사진) 전송
            const photoMedia: InputMediaPhoto[] = result.images!.map((img, index) => {
                const item: InputMediaPhoto = {type: 'photo', media: img.buffer as any};
                if (index === 0 && caption) {
                    item.caption = caption;
                    item.parse_mode = 'HTML';
                }
                return item;
            });
            const sentPhotoMessages = await bot.sendMediaGroup(chatId, photoMedia, {reply_to_message_id: replyToId});
            for (const sentMsg of sentPhotoMessages) {
                logMessage(sentMsg, BOT_ID, logType, {parts: result.parts});
            }

            // 2. 파일(원본) 전송 - 앨범의 첫 번째 사진에 답장
            const replyToPhotoId = sentPhotoMessages[0].message_id;
            const docMedia: any[] = result.images!.map((img, index) => {
                return {
                    type: 'document',
                    media: img.buffer as any,
                    caption: index === 0 ? '원본 파일' : undefined // 선택적 캡션
                };
            });
            const sentDocMessages = await bot.sendMediaGroup(chatId, docMedia, {reply_to_message_id: replyToPhotoId});
            for (const sentMsg of sentDocMessages) {
                logMessage(sentMsg, BOT_ID, logType, {parts: result.parts});
            }

        } else {
            // 1. 사진 전송
            const sentPhotoMsg = await bot.sendPhoto(chatId, result.images![0].buffer, {
                caption: caption,
                parse_mode: caption ? 'HTML' : undefined,
                reply_to_message_id: replyToId
            });
            logMessage(sentPhotoMsg, BOT_ID, logType, {parts: result.parts});

            // 2. 파일 전송 - 보낸 사진에 답장
            const sentDocMsg = await bot.sendDocument(chatId, result.images![0].buffer, {
                reply_to_message_id: sentPhotoMsg.message_id
            }, {
                filename: 'image.png', // 파일명 지정
                contentType: result.images![0].mimeType || 'image/png'
            });
            logMessage(sentDocMsg, BOT_ID, logType, {parts: result.parts});
        }
        console.log(`성공: 사용자(ID: ${commandMsg.from?.id})에게 ${result.images!.length}개의 콘텐츠 전송 완료.`);
        return; // 이미지 처리 완료 후 종료
    }

    // 3. 텍스트 및 기타 파트 처리
    if (result.parts && result.parts.length > 0) {
        let fullResponse = '';
        for (const part of result.parts) {
            if (part.text) {
                fullResponse += part.text;
            } else if (part.executableCode) {
                const code = part.executableCode.code;
                fullResponse += `\n\n<b>[코드 실행]</b>\n<pre><code class="language-python">${escapeHtml(code ?? '')}</code></pre>`;
            } else if (part.codeExecutionResult) {
                const output = part.codeExecutionResult.output;
                const outcome = part.codeExecutionResult.outcome;
                const outcomeIcon = outcome === 'OUTCOME_OK' ? '✅' : '❌';
                fullResponse += `\n<b>[실행 결과 ${outcomeIcon}]</b>\n<pre><code>${escapeHtml(output ?? '')}</code></pre>`;
            }
        }

        // Grounding Metadata 처리
        if (result.groundingMetadata) {
            const {webSearchQueries, groundingChunks} = result.groundingMetadata;
            let metadataText = '\n';

            if (webSearchQueries && webSearchQueries.length > 0) {
                metadataText += `\n---\n🔍 **검색어**: ${webSearchQueries.map(q => `'${q}'`).join(', ')}\n`;
            }

            if (groundingChunks && groundingChunks.length > 0) {
                const uniqueSources = new Map<string, string>();
                groundingChunks.forEach(chunk => {
                    if (chunk.web && chunk.web.uri && chunk.web.title) {
                        uniqueSources.set(chunk.web.uri, chunk.web.title);
                    }
                });

                if (uniqueSources.size > 0) {
                    metadataText += `\n📚 **출처**:\n`;
                    uniqueSources.forEach((title, uri) => {
                        metadataText += ` - [${title}](${uri})\n`;
                    });
                }
            }
            fullResponse += metadataText;
        }

        const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(fullResponse.trim() || '') as string, replyToId);
        logMessage(sentMsg, BOT_ID, logType, {parts: result.parts});
    } else {
        // 텍스트도 없고 이미지도 없는 경우
        const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
        logMessage(sentMsg, BOT_ID, 'error');
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
