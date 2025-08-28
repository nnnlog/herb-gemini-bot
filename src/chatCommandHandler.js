import {isUserAuthorized} from './auth.js';
import {generateFromHistory} from './aiHandler.js';
import {logMessage, getConversationHistory} from './db.js';
import {buildContents, sendLongMessage} from './utils.js';
import {marked} from 'marked';

async function handleChatCommand(commandMsg, albumMessages = [], bot, BOT_ID, config, replyToId) {
    const chatId = commandMsg.chat.id;
    try {
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB
        const conversationHistory = await getConversationHistory(chatId, commandMsg);
        let {contents, totalSize} = await buildContents(bot, conversationHistory, commandMsg, albumMessages, 'gemini');

        if (totalSize > MAX_FILE_SIZE) {
            const sentMsg = await bot.sendMessage(chatId, `총 파일 용량이 100MB를 초과할 수 없습니다. (현재: ${Math.round(totalSize / 1024 / 1024)}MB)`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        // parts가 비어있는 비유효 턴을 제거하되, 사용자의 마지막 프롬프트(명령어) 턴은 유지
        contents = contents.filter((turn, index) => turn.parts.length > 0 || index === contents.length - 1);

        if (contents.length === 0) {
            const sentMsg = await bot.sendMessage(chatId, "메시지가 비어있습니다.", {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const tools = [
            {googleSearch: {}},
            {urlContext: {}},
            {codeExecution: {}},
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
            const sentMsg = await bot.sendMessage(chatId, `응답 생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        } else if (result.parts?.length > 0) {
            let fullResponse = '';
            for (const part of result.parts) {
                if (part.text) {
                    fullResponse += part.text;
                } else if (part.executableCode) {
                    const code = part.executableCode.code;
                    fullResponse += `\n\n<b>[코드 실행]</b>\n<pre><code class="language-python">${escapeHtml(code)}</code></pre>`;
                } else if (part.codeExecutionResult) {
                    const output = part.codeExecutionResult.output;
                    const outcome = part.codeExecutionResult.outcome;
                    const outcomeIcon = outcome === 'OUTCOME_OK' ? '✅' : '❌';
                    fullResponse += `\n<b>[실행 결과 ${outcomeIcon}]</b>\n<pre>${escapeHtml(output)}</pre>`;
                }
            }
            const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(fullResponse.trim() || ''), replyToId);
            logMessage(sentMsg, BOT_ID, 'chat');
        } else {
            const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        }
    } catch (error) {
        console.error("채팅 명령어 처리 중 오류:", error);
        const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", {reply_to_message_id: replyToId});
        logMessage(sentMsg, BOT_ID, 'error');
    } finally {
        // 처리가 완료되면 성공/실패 여부와 관계없이 반응을 제거합니다.
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

// HTML 태그 문자를 이스케이프하는 헬퍼 함수
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export {handleChatCommand};