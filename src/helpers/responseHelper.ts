import {marked} from 'marked';
import TelegramBot from "node-telegram-bot-api";
import {GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';
import {sendLongMessage} from './utils.js';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function buildFullText(result: GenerationOutput): string {
    if (!result.parts || result.parts.length === 0) {
        return '';
    }

    let fullResponse = '';

    // parts 순회
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

    return marked.parseInline(fullResponse.trim()) as string;
}

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

    // 2. 전체 텍스트 빌드
    const fullText = buildFullText(result);
    const hasText = fullText.length > 0;
    const hasImages = result.images && result.images.length > 0;

    // 3. 텍스트 + 이미지 통합 전송 (sendLongMessage)
    if (hasText || hasImages) {
        const textToSend = hasText ? fullText : '';
        const images = hasImages ? result.images : undefined;

        const lastTextMsg = await sendLongMessage(bot, chatId, textToSend, replyToId, images);
        logMessage(lastTextMsg, BOT_ID, logType, {parts: result.parts});

        // 4. 원본 파일 전송 (이미지가 있는 경우)
        if (hasImages) {
            if (result.images!.length === 1) {
                // 단일 이미지: sendDocument
                const docMsg = await bot.sendDocument(chatId, result.images![0].buffer, {
                    reply_to_message_id: lastTextMsg.message_id
                }, {
                    filename: 'image.png',
                    contentType: result.images![0].mimeType || 'image/png'
                });
                logMessage(docMsg, BOT_ID, logType, {parts: result.parts});
            } else {
                // 다중 이미지: sendMediaGroup
                const docMedia = result.images!.map((img, index) => ({
                    type: 'document' as const,
                    media: img.buffer as any,
                    caption: index === 0 ? '원본 파일' : undefined
                }));
                const docMsgs = await bot.sendMediaGroup(chatId, docMedia, {
                    reply_to_message_id: lastTextMsg.message_id
                });
                for (const docMsg of docMsgs) {
                    logMessage(docMsg, BOT_ID, logType, {parts: result.parts});
                }
            }
            console.log(`성공: 사용자(ID: ${commandMsg.from?.id})에게 ${result.images!.length}개의 콘텐츠 전송 완료.`);
        }
    } else {
        // 텍스트도 이미지도 없는 경우
        const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
        logMessage(sentMsg, BOT_ID, 'error');
    }
}
