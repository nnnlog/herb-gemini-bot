import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import type TelegramBot from 'node-telegram-bot-api';
import type {CommandContext} from '../../src/commands/BaseCommand.js';

// CommandType enum 값 (실제 소스와 동기화)
const CommandType = {
    GEMINI: 'gemini',
    IMAGE: 'image',
    MAP: 'map',
    SUMMARIZE: 'summarize',
    ERROR: 'error'
} as const;

// Mocks
const mockLogMessage = jest.fn();
const mockGetConversationHistory = jest.fn();
const mockGenerateContent = jest.fn<any>();

// Mock DB
jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getConversationHistory: mockGetConversationHistory,
    getMessage: jest.fn<any>().mockResolvedValue(null),
    CommandType
}));

// Mock GenAI
jest.unstable_mockModule('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
            generateContent: mockGenerateContent
        }
    })),
    GroundingMetadata: {},
    Part: {},
    Content: {},
    GenerateContentParameters: {}
}));

describe('GenAICommand', () => {
    let GenAICommand: any;
    let TestGenAICommand: any;
    let command: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Dynamically import to ensure mocks are applied in ESM
        const module = await import('../../src/commands/GenAICommand.js');
        GenAICommand = module.GenAICommand;

        // Concrete implementation for testing abstract class
        TestGenAICommand = class extends GenAICommand {
            public name = 'test';
            public aliases = ['t', 'te'];
            public showInList = false;
            public description = 'test command';
            public execute = jest.fn<any>();

            public async publicBuildPrompt(ctx: CommandContext) {
                return this.buildPrompt(ctx);
            }

            public publicFormatResponse(result: any) {
                return this.formatResponse(result);
            }

            public async publicCallAI(params: any, apiKey: string) {
                return this.callAI(params, apiKey);
            }
        };

        command = new TestGenAICommand();

        mockBot = {
            sendMessage: jest.fn<any>().mockResolvedValue({message_id: 2})
        } as unknown as TelegramBot;

        mockContext = {
            sender: mockBot as any,
            msg: {
                message_id: 1,
                chat: {id: 123},
                from: {id: 100, is_bot: false}
            } as any,
            commandName: 'test',
            args: {},
            config: {} as any,
            botId: 999,
            session: {history: []} as any,
            isImplicit: false,
            cleanedText: 'hello'
        };

        mockGenerateContent.mockResolvedValue({
            text: 'AI Response',
            candidates: [{content: {parts: [{text: 'AI Response'}]}}]
        });
    });

    describe('buildPrompt', () => {
        it('should build prompt from history (simple text)', async () => {
            mockContext.session.history = [{role: 'user', text: 'hello', files: [] as any}] as any;
            const result = await command.publicBuildPrompt(mockContext);
            expect(result.contents).toBeDefined();
            expect(result.contents[0]?.parts?.[0]?.text).toBe('hello');
        });

        it('should handle empty prompt validation (after cleaning)', async () => {
            mockContext.session.history = [{role: 'user', text: '/test', files: [] as any}] as any;
            const result = await command.publicBuildPrompt(mockContext);
            expect(result.error).toContain('프롬프트로 삼을 유효한 메시지가 없습니다');
        });

        it('should return error if history is empty', async () => {
            mockContext.session.history = [];
            const result = await command.publicBuildPrompt(mockContext);
            expect(result.error).toContain('프롬프트로 삼을 유효한 메시지가 없습니다');
        });

        // Prefix Stripping test cases from split file
        const prefixTestCases = [
            {input: '/test hello', expected: 'hello', name: 'Standard command'},
            {input: '/t hello', expected: 'hello', name: 'Alias command'},
            {input: '/TEST hello', expected: 'hello', name: 'Uppercase command'},
            {input: '/T hello', expected: 'hello', name: 'Uppercase alias'},
            {input: '/test@mybot hello', expected: 'hello', name: 'Command with bot mention'},
            {input: '/test    hello', expected: 'hello', name: 'Command with multiple spaces'},
            {input: '/test\nhello', expected: 'hello', name: 'Command with newline'},
            {input: 'hello', expected: 'hello', name: 'No command (implicit/reply)'},
        ];

        prefixTestCases.forEach(({input, expected, name}) => {
            it(`should strip prefix for: ${name} ("${input}")`, async () => {
                mockContext.session.history = [{role: 'user', text: input, files: [] as any}] as any;
                const result = await command.publicBuildPrompt(mockContext);
                expect(result.contents).toBeDefined();
                expect(result.contents.length).toBeGreaterThan(0);
                expect(result.contents[0].parts?.[0]?.text).toBe(expected);
            });
        });
    });

    describe('formatResponse', () => {
        it('should return empty string for empty result', () => {
            const result = command.publicFormatResponse({parts: []});
            expect(result).toBe('');
        });

        it('should format text parts correctly', () => {
            const result = command.publicFormatResponse({
                parts: [{text: 'Hello, world!'}]
            });
            expect(result).toContain('Hello, world!');
        });

        it('should format executableCode blocks', () => {
            const result = command.publicFormatResponse({
                parts: [{executableCode: {code: 'print("test")'}}]
            });
            expect(result).toContain('[코드 실행]');
            expect(result).toContain('print("test")');
        });

        it('should format codeExecutionResult with success icon', () => {
            const result = command.publicFormatResponse({
                parts: [{codeExecutionResult: {output: 'result', outcome: 'OUTCOME_OK'}}]
            });
            expect(result).toContain('[실행 결과 ✅]');
            expect(result).toContain('result');
        });

        it('should format codeExecutionResult with failure icon', () => {
            const result = command.publicFormatResponse({
                parts: [{codeExecutionResult: {output: 'error', outcome: 'OUTCOME_FAILED'}}]
            });
            expect(result).toContain('[실행 결과 ❌]');
        });

        it('should format grounding metadata with search queries', () => {
            const result = command.publicFormatResponse({
                parts: [{text: 'Response'}],
                groundingMetadata: {
                    webSearchQueries: ['query1', 'query2']
                }
            });
            expect(result).toContain('🔍');
            expect(result).toContain('query1');
            expect(result).toContain('query2');
        });

        it('should format grounding metadata with sources', () => {
            const result = command.publicFormatResponse({
                parts: [{text: 'Response'}],
                groundingMetadata: {
                    groundingChunks: [
                        {web: {uri: 'https://example.com', title: 'Example Site'}}
                    ]
                }
            });
            expect(result).toContain('📚');
            expect(result).toContain('Example Site');
            expect(result).toContain('https://example.com');
        });
    });

    describe('validate', () => {
        it('should pass validation when cleanedText has content', async () => {
            mockContext.cleanedText = 'some prompt';
            const result = await command.validate(mockContext);
            expect(result).toBe(true);
        });

        it('should pass validation for implicit commands', async () => {
            mockContext.isImplicit = true;
            mockContext.cleanedText = '';
            const result = await command.validate(mockContext);
            expect(result).toBe(true);
        });

        it('should pass validation when reply_to_message exists', async () => {
            mockContext.cleanedText = '';
            mockContext.msg.reply_to_message = {message_id: 5} as any;
            const result = await command.validate(mockContext);
            expect(result).toBe(true);
        });

        it('should pass validation when media is attached', async () => {
            mockContext.cleanedText = '';
            mockContext.msg.photo = [{file_id: 'abc'}] as any;
            const result = await command.validate(mockContext);
            expect(result).toBe(true);
        });

        it('should fail validation when replying to bot with only command', async () => {
            mockContext.cleanedText = '';
            mockContext.msg.reply_to_message = {
                message_id: 5,
                from: {id: 999, is_bot: true}  // botId is 999
            } as any;
            const result = await command.validate(mockContext);
            expect(result).toBe(false);
            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                123,
                "봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.",
                expect.any(Object)
            );
        });

        it('should pass validation when replying to non-bot user message', async () => {
            mockContext.cleanedText = '';
            mockContext.msg.reply_to_message = {
                message_id: 5,
                from: {id: 200, is_bot: false}
            } as any;
            const result = await command.validate(mockContext);
            expect(result).toBe(true);
        });

        it('should fail validation when no content, no media, no reply', async () => {
            mockContext.cleanedText = '';
            mockContext.msg.reply_to_message = undefined;
            const result = await command.validate(mockContext);
            expect(result).toBe(false);
            expect(mockBot.sendMessage).toHaveBeenCalledWith(
                123,
                "명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.",
                expect.any(Object)
            );
        });
    });

    describe('callAI (AbortSignal)', () => {
        it('should create AbortSignal.timeout if timeout is set and abortSignal is missing', async () => {
            const params: any = {
                model: 'model',
                contents: [{role: 'user', parts: [{text: 'test'}]}],
                config: {
                    httpOptions: {timeout: 5000}
                }
            };
            await command.publicCallAI(params, 'key');
            expect(params.config.abortSignal).toBeDefined();
            expect(params.config.abortSignal instanceof AbortSignal).toBe(true);
        });

        it('should NOT overwrite existing abortSignal', async () => {
            const existingSignal = new AbortController().signal;
            const params: any = {
                model: 'model',
                contents: [{role: 'user', parts: [{text: 'test'}]}],
                config: {
                    httpOptions: {timeout: 5000},
                    abortSignal: existingSignal
                }
            };
            await command.publicCallAI(params, 'key');
            expect(params.config.abortSignal).toBe(existingSignal);
        });

        it('should NOT create abortSignal if timeout is missing', async () => {
            const params: any = {
                model: 'model',
                contents: [{role: 'user', parts: [{text: 'test'}]}],
                config: {}
            };
            await command.publicCallAI(params, 'key');
            expect(params.config.abortSignal).toBeUndefined();
        });

        it('should catch AbortError', async () => {
            const spy = jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
                cb();
                return {} as any;
            });

            const controller = new AbortController();
            const params: any = {
                model: 'model',
                contents: [{role: 'user', parts: [{text: 'test'}]}],
                config: {abortSignal: controller.signal}
            };

            const error = new Error('The user aborted a request.');
            error.name = 'AbortError';
            mockGenerateContent.mockRejectedValue(error);

            const result = await command.publicCallAI(params, 'key');
            expect(result.error).toContain('AI 응답 대기 시간이 초과되었습니다. (Timeout)');

            spy.mockRestore();
        });
    });
});
