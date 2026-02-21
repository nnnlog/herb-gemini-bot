import {GenerateContentParameters} from '@google/genai';
import {CommandType, logMessage} from '../services/db.js';
import {CommandContext} from './BaseCommand.js';
import {GenAICommand} from './GenAICommand.js';

export class ChatCommand extends GenAICommand {
    public readonly name = 'gemini';
    public readonly aliases = ['chat', 'g'];
    public readonly description = 'Gemini 3.0 Pro 모델과 대화합니다.';
    public readonly showInList = true;

    public async execute(ctx: CommandContext): Promise<void> {
        const {sender, msg, config, session, isImplicit} = ctx;
        const replyToId = msg.message_id;

        // 반응 추가 (처리 중)
        await sender.setMessageReaction(msg.chat.id, replyToId, {reaction: [{type: 'emoji', emoji: '👍'}]});

        try {
            // 프롬프트 생성
            const {contents, error} = await this.buildPrompt(ctx);
            if (error) {
                await this.reply(ctx, error);
                return;
            }

            const request: GenerateContentParameters = {
                model: config.geminiProModel,
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
                        timeout: 1000 * 60 * 10,
                    },
                }
            };

            // AI 호출
            const result = await this.callAI(request, config.googleApiKey);

            if (result.error) {
                await this.reply(ctx, result.error);
                logMessage(msg, ctx.botId, CommandType.ERROR);
                return;
            }

            // 텍스트 구성
            const responseText = this.formatResponse(result);
            const images = result.images;

            // 전송
            const sentMessages = await this.reply(ctx, responseText, undefined, images);

            // 모델 응답을 DB에 기록
            if (sentMessages.length > 0) {
                const firstMsg = sentMessages[0];
                await logMessage(firstMsg, ctx.botId, CommandType.GEMINI, {parts: result.parts});

                for (let i = 1; i < sentMessages.length; i++) {
                    await logMessage(sentMessages[i], ctx.botId, CommandType.GEMINI, {linkedMessageId: firstMsg.message_id});
                }
            }

        } catch (error) {
            await this.handleError(ctx, error);
        } finally {
            sender.setMessageReaction(msg.chat.id, replyToId, {reaction: []});
        }
    }
}
