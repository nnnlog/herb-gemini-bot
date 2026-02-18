import {Content, GenerateContentParameters, GoogleGenAI, GroundingMetadata, Part} from '@google/genai';
import {marked} from 'marked';
import TelegramBot from 'node-telegram-bot-api';
import {getFileBuffer} from '../helpers/utils.js';
import {logMessage} from '../services/db.js';
import {BaseCommand, CommandContext, ImageData} from './BaseCommand.js';

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export interface GenerationOutput {
    error?: string;
    images?: ImageData[];
    parts?: Part[];
    text?: string;
    groundingMetadata?: GroundingMetadata;
}

interface TelegramFile {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_name?: string;
}

export abstract class GenAICommand extends BaseCommand {
    private static readonly MAX_RETRIES = 3;
    private static readonly mimeMap: {[key: string]: string} = {
        'pdf': 'application/pdf', 'py': 'text/x-python', 'js': 'text/javascript',
        'ts': 'text/typescript', 'java': 'text/x-java-source', 'c': 'text/x-c',
        'cpp': 'text/x-c++', 'cs': 'text/x-csharp', 'swift': 'text/x-swift',
        'php': 'text/x-php', 'rb': 'text/x-ruby', 'kt': 'text/x-kotlin',
        'go': 'text/x-go', 'rs': 'text/rust', 'html': 'text/html', 'css': 'text/css',
    };

    /**
     * 텍스트에서 명령어 인수를 정리하는 헬퍼 함수
     */
    protected cleanText(text: string): string {
        return text;
    }

    /**
     * 프롬프트 유효성 검사
     * - 명령어만 있고 내용이 없는 경우 거절
     * - 봇 응답에 명령어만으로 답장하는 경우 거절
     */
    public override async validate(ctx: CommandContext): Promise<boolean> {
        const {msg, bot, cleanedText, isImplicit, botId} = ctx;

        // 암시적 명령(답장)은 항상 유효
        if (isImplicit) return true;

        const hasMedia = msg.photo || msg.document;
        const hasText = cleanedText.trim().length > 0;
        const originalMsg = msg.reply_to_message;

        // 미디어나 텍스트가 있으면 유효
        if (hasMedia || hasText) return true;

        // 봇 응답에 명령어만으로 답장하는 경우 거절
        if (originalMsg?.from?.id === botId) {
            await bot.sendMessage(msg.chat.id, "봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.", {
                reply_to_message_id: msg.message_id
            });
            return false;
        }

        // 다른 사용자 메시지에 답장하는 경우는 허용 (해당 메시지를 프롬프트로 사용)
        if (originalMsg) return true;

        // 아무것도 없으면 거절
        await bot.sendMessage(msg.chat.id, "명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.", {
            reply_to_message_id: msg.message_id
        });
        return false;
    }

    /**
     * AI 응답을 HTML 형식으로 포맷팅합니다.
     * - 코드 실행 결과 (executableCode, codeExecutionResult) 처리
     * - Grounding Metadata (검색어, 출처) 표시
     */
    protected formatResponse(result: GenerationOutput): string {
        if (!result.parts || result.parts.length === 0) {
            return result.text || '';
        }

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

        return marked.parseInline(fullResponse.trim()) as string;
    }

    protected async buildPrompt(ctx: CommandContext, albumMessages: TelegramBot.Message[] = []): Promise<{contents: Content[], totalSize: number, error?: string}> {
        const {session, bot, args} = ctx;
        const history = session.history;
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB
        let totalSize = 0;

        const contents: Content[] = await Promise.all(
            history.map(async (turn) => {
                if (turn.parts && turn.parts.length > 0) {
                    let parts = turn.parts;
                    if (this.name === 'image') {
                        parts = parts.filter(part => !('functionCall' in part) && !('functionResponse' in part));
                    }
                    return {role: turn.role, parts};
                }

                turn.files.forEach(f => totalSize += f.file_size || 0);
                const fileParts = await this.createFileParts(bot, turn.files);
                const parts: Part[] = [...fileParts];

                const aliases = [this.name, ...this.aliases];
                const commandRegex = new RegExp(`^/(?:${aliases.join('|')})(?:@\\w+bot)?\\s*`, 'i');
                let cleanText = turn.text.replace(commandRegex, '').trim();

                if (this.parameters && this.parameters.length > 0) {
                    this.parameters.forEach(param => {
                        if (param.allowedValues) {
                            const words = cleanText.split(/\s+/);
                            if (words.length > 0 && param.allowedValues.includes(words[0])) {
                                cleanText = words.slice(1).join(' ');
                            }
                        }
                    });
                }

                if (cleanText) {
                    parts.push({text: cleanText});
                }
                return {role: turn.role, parts};
            })
        );

        // 현재 메시지 아티팩트 처리
        const allMessages = [ctx.msg, ...albumMessages];
        const historyFileIds = new Set(history.flatMap(turn => turn.files.map(f => f.file_id)));

        const currentFiles: TelegramFile[] = allMessages
            .flatMap(m => (m.photo ? [{
                ...m.photo[m.photo.length - 1],
                file_unique_id: m.photo[m.photo.length - 1].file_unique_id,
                file_id: m.photo[m.photo.length - 1].file_id,
                file_size: m.photo[m.photo.length - 1].file_size || 0,
                file_name: 'image.jpg'
            }] : (m.document ? [{
                file_id: m.document.file_id,
                file_unique_id: m.document.file_unique_id,
                file_size: m.document.file_size || 0,
                file_name: m.document.file_name
            }] : [])))
            .filter(f => !!(f && f.file_id && !historyFileIds.has(f.file_id)));

        if (currentFiles.length > 0) {
            currentFiles.forEach(f => totalSize += f.file_size || 0);
            const fileParts = await this.createFileParts(bot, currentFiles);

            if (contents.length > 0) {
                const lastContent = contents[contents.length - 1];
                if (lastContent.parts) {
                    lastContent.parts.push(...fileParts);
                } else {
                    lastContent.parts = [...fileParts];
                }
            }
        }

        if (totalSize > MAX_FILE_SIZE) {
            return {contents: [], totalSize, error: `총 파일 용량이 100MB를 초과할 수 없습니다. (${Math.round(totalSize / 1024 / 1024)}MB)`};
        }

        const validContents = contents.filter(t => t.parts && t.parts.length > 0);
        if (validContents.length === 0) {
            return {contents: [], totalSize, error: "프롬프트로 삼을 유효한 메시지가 없습니다."};
        }

        return {contents: validContents, totalSize};
    }

    protected async createFileParts(bot: TelegramBot, files: TelegramFile[]): Promise<Part[]> {
        if (!files || files.length === 0) return [];
        return Promise.all(files.map(async (file) => {
            const buffer = await getFileBuffer(bot, file.file_id);
            const mimeType = this.getMimeType(file.file_name);
            return {inlineData: {data: buffer.toString('base64'), mimeType}};
        }));
    }

    private getMimeType(fileName: string = ''): string {
        if (fileName.match(/\.(jpg|jpeg|png)$/i)) return 'image/jpeg';
        const ext = fileName.split('.').pop()?.toLowerCase();
        return (ext && GenAICommand.mimeMap[ext]) || 'application/octet-stream';
    }

    protected async callAI(params: GenerateContentParameters, apiKey: string): Promise<GenerationOutput> {
        const genAI = new GoogleGenAI({apiKey});
        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        // httpOptions.timeout이 설정되어 있고 abortSignal이 없으면 자동으로 설정
        if (params.config?.httpOptions?.timeout && !params.config.abortSignal) {
            params.config.abortSignal = AbortSignal.timeout(params.config.httpOptions.timeout);
        }

        for (let attempt = 1; attempt <= GenAICommand.MAX_RETRIES; attempt++) {
            try {
                console.log(`[${this.name}] API Request (Attempt ${attempt})...`);
                const result = await genAI.models.generateContent(params);

                if (result.promptFeedback?.blockReason) {
                    return {error: `프롬프트 차단됨: ${result.promptFeedback.blockReason}`};
                }
                const candidate = result.candidates?.[0];
                if (candidate?.finishReason === 'PROHIBITED_CONTENT' || candidate?.finishReason === 'SAFETY') {
                    return {error: '생성된 내용이 안전 정책에 의해 차단되었습니다.'};
                }
                if (candidate?.finishReason === 'MALFORMED_FUNCTION_CALL') {
                    return {error: '함수 호출 오류입니다.'};
                }

                const output: GenerationOutput = {};
                if (result.text) output.text = result.text;

                const images: ImageData[] = [];
                result.candidates?.forEach(cand => {
                    cand.content?.parts?.forEach(part => {
                        if (part.inlineData?.mimeType?.startsWith('image/') && part.inlineData.data) {
                            images.push({
                                buffer: Buffer.from(part.inlineData.data, 'base64'),
                                mimeType: part.inlineData.mimeType
                            });
                        }
                    });
                });
                if (images.length > 0) output.images = images;
                if (result.candidates?.[0]?.content?.parts) {
                    output.parts = result.candidates[0].content.parts;
                }
                if (result.candidates?.[0]?.groundingMetadata) {
                    output.groundingMetadata = result.candidates[0].groundingMetadata;
                }

                if (Object.keys(output).length === 0) {
                    return {error: '응답에 데이터가 없습니다.'};
                }
                return output;

            } catch (error: any) {
                const msg = error.message || '';
                if ((msg.includes('503') || msg.includes('500') || msg.includes('fetch failed')) && attempt < GenAICommand.MAX_RETRIES) {
                    await delay(attempt * 1000 + 1000);
                    continue;
                }
                console.error("AI Error:", error);
                return {error: `API 오류: ${msg}`};
            }
        }
        return {error: '최대 재시도 횟수를 초과했습니다.'};
    }

    protected async handleError(ctx: CommandContext, error: unknown) {
        console.error(`Error executing ${this.name}:`, error);
        const errText = error instanceof Error ? error.message : 'Unknown error';
        await ctx.bot.sendMessage(ctx.msg.chat.id, "오류가 발생했습니다.", {reply_to_message_id: ctx.msg.message_id});
        logMessage(ctx.msg, ctx.botId, errText); // 오류 로그
    }
}
