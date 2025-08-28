import {generateFromHistory, GenerationOutput} from './aiHandler.js';
import {logMessage, getConversationHistory} from './db.js';
import {buildContents, sendLongMessage} from './utils.js';
import {marked} from 'marked';
import TelegramBot from "node-telegram-bot-api";
import { Config } from './config.js';
import { GenerateContentParameters } from '@google/genai';

async function handleChatCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB
        const conversationHistory = await getConversationHistory(chatId, commandMsg);
        let {contents, totalSize} = await buildContents(bot, conversationHistory, commandMsg, albumMessages, 'gemini');

        if (totalSize > MAX_FILE_SIZE) {
            const sentMsg = await bot.sendMessage(chatId, `총 파일 용량이 100MB를 초과할 수 없습니다. (현재: ${Math.round(totalSize / 1024 / 1024)}MB)`, {reply_to_message_id: replyToId});
            await logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        // parts가 비어있는 비유효 턴을 제거하되, 사용자의 마지막 프롬프트(명령어) 턴은 유지
        contents = contents.filter((turn, index) => (turn.parts && turn.parts.length > 0) || index === contents.length - 1);

        if (contents.length === 0) {
            const sentMsg = await bot.sendMessage(chatId, "메시지가 비어있습니다.", {reply_to_message_id: replyToId});
            await logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const request: GenerateContentParameters = {
            model: config.geminiProModel!,
            contents: contents,
            config: {
                tools: [
                    {googleSearch: {}},
                    {codeExecution: {}},
                    {urlContext: {}},
                ],
                thinkingConfig: {
                    thinkingBudget: 32768,
                },
                httpOptions: {
                    timeout: 120000,
                },
            }
        };

        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        if (result.error) {
            const sentMsg = await bot.sendMessage(chatId, `응답 생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
            await logMessage(sentMsg, BOT_ID, 'error');
        } else if (result.parts && result.parts.length > 0) {
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
                    fullResponse += `\n<b>[실행 결과 ${outcomeIcon}]</b>\n<pre>${escapeHtml(output ?? '')}</pre>`;
                }
            }

            // Grounding Metadata 처리
            if (result.groundingMetadata) {
                const { webSearchQueries, groundingChunks } = result.groundingMetadata;
                let metadataText = '\n';

                if (webSearchQueries && webSearchQueries.length > 0) {
                    metadataText += `\n---\n🔍 **검색어**: ${webSearchQueries.map(q => `'${q}'`).join(', ' )}\n`;
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
            await logMessage(sentMsg, BOT_ID, 'chat');
        } else {
            const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
            await logMessage(sentMsg, BOT_ID, 'error');
        }
    } catch (error: unknown) {
        console.error("채팅 명령어 처리 중 오류:", error);
        const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", {reply_to_message_id: replyToId});
        if (error instanceof Error) {
            await logMessage(sentMsg, BOT_ID, error.message);
        } else {
            await logMessage(sentMsg, BOT_ID, 'unknown error');
        }
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export {handleChatCommand};
