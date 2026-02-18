import {GenerateContentParameters} from '@google/genai';
import {logMessage} from '../services/db.js';
import {CommandContext} from './BaseCommand.js';
import {GenAICommand} from './GenAICommand.js';

export class MapCommand extends GenAICommand {
    public readonly name = 'map';
    public readonly aliases = ['map'];
    public readonly description = 'Google 지도 기능이 활성화된 상태로 Gemini 3.0 Pro 모델과 대화합니다.';
    public readonly showInList = true;

    public async execute(ctx: CommandContext): Promise<void> {
        const {bot, config, msg} = ctx;
        const replyToId = msg.message_id;

        // 반응 추가 (처리 중)
        await bot.setMessageReaction(msg.chat.id, replyToId, {reaction: [{type: 'emoji', emoji: '👍'}]});

        try {
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
                        {googleMaps: {}},
                        {urlContext: {}}
                    ],
                    thinkingConfig: {thinkingBudget: 32768},
                    httpOptions: {
                        timeout: 1000 * 60 * 10,
                    }
                }
            };

            const result = await this.callAI(request, config.googleApiKey);

            if (result.error) {
                await this.reply(ctx, result.error);
                return;
            }

            const sentMessages = await this.reply(ctx, this.formatResponse(result), undefined, result.images);
            if (sentMessages.length > 0) {
                const firstMsg = sentMessages[0];
                await logMessage(firstMsg, ctx.botId, 'map', {parts: result.parts});

                for (let i = 1; i < sentMessages.length; i++) {
                    await logMessage(sentMessages[i], ctx.botId, 'map', {linkedMessageId: firstMsg.message_id});
                }
            }

        } catch (error) {
            await this.handleError(ctx, error);
        } finally {
            bot.setMessageReaction(msg.chat.id, replyToId, {reaction: []});
        }
    }
}
