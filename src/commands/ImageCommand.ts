import {GenerateContentParameters} from '@google/genai';
import {CommandType, logMessage} from '../services/db.js';
import {CommandContext} from './BaseCommand.js';
import {GenAICommand} from './GenAICommand.js';

export class ImageCommand extends GenAICommand {
    public readonly name = 'image';
    public readonly aliases = ['img'];
    public readonly description = 'Gemini 3.0 Pro Image 모델로 이미지를 생성합니다.';
    public readonly showInList = true;
    public readonly parameters = [
        {
            name: 'resolution',
            type: 'string' as const,
            allowedValues: ['1k', '2k', '4k'],
            defaultValue: '1k',
            description: '이미지 해상도 (기본값: 1k)'
        }
    ];

    public async execute(ctx: CommandContext): Promise<void> {
        const {sender, msg, config, args, isImplicit} = ctx;
        const replyToId = msg.message_id;

        // 반응 추가 (처리 중)
        await sender.setMessageReaction(msg.chat.id, replyToId, {reaction: [{type: 'emoji', emoji: '👍'}]});

        try {
            const {contents, error} = await this.buildPrompt(ctx);
            if (error) {
                await this.reply(ctx, error);
                return;
            }

            const resolution = args['resolution'] || '1k';

            const request: GenerateContentParameters = {
                model: config.imageModelName,
                contents: contents,
                config: {
                    tools: [
                        {googleSearch: {}}
                    ],
                    imageConfig: {
                        imageSize: resolution.toUpperCase(),
                    },
                    httpOptions: {
                        timeout: 1000 * 60 * 10,
                    },
                },
            };

            const result = await this.callAI(request, config.googleApiKey);

            if (result.error) {
                await this.replyWithError(ctx, result.error);
                return;
            }

            // 응답 전송
            const sentMessages = await this.reply(ctx, this.formatResponse(result), undefined, result.images);

            // 로그
            if (sentMessages.length > 0) {
                const firstMsg = sentMessages[0];
                await logMessage(firstMsg, ctx.botId, CommandType.IMAGE, {parts: result.parts});

                for (let i = 1; i < sentMessages.length; i++) {
                    await logMessage(sentMessages[i], ctx.botId, CommandType.IMAGE, {linkedMessageId: firstMsg.message_id});
                }
            }

        } catch (error) {
            await this.handleError(ctx, error);
        } finally {
            sender.setMessageReaction(msg.chat.id, replyToId, {reaction: []});
        }
    }
}
