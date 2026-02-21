import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {CommandContext} from '../../src/commands/BaseCommand.js';

// CommandType enum 값 (실제 소스와 동기화)
const CommandType = {
    GEMINI: 'gemini',
    IMAGE: 'image',
    MAP: 'map',
    SUMMARIZE: 'summarize',
    ERROR: 'error'
} as const;

const mockCallAI = jest.fn<any>();
const mockLogMessage = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getConversationHistory: jest.fn<any>().mockResolvedValue([]),
    getMessage: jest.fn<any>().mockResolvedValue(null),
    CommandType
}));

describe('SummarizeCommand', () => {
    let SummarizeCommand: any;
    let command: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module = await import('../../src/commands/SummarizeCommand.js');
        SummarizeCommand = module.SummarizeCommand;

        mockCallAI.mockResolvedValue({
            text: 'Summary',
            parts: [{text: 'Summary'}],
            images: []
        });

        command = new SummarizeCommand();
        (command as any).callAI = mockCallAI;
        (command as any).buildPrompt = jest.fn<any>().mockResolvedValue({contents: [{parts: [{text: 'http://example.com'}]}]});
        (command as any).reply = jest.fn<any>().mockResolvedValue([{message_id: 100}]);
        (command as any).handleError = jest.fn<any>();

        mockBot = {setMessageReaction: jest.fn<any>()} as unknown as TelegramBot;
        mockContext = {
            sender: mockBot as any,
            msg: {message_id: 1, chat: {id: 123}} as TelegramBot.Message,
            commandName: 'summarize',
            args: {},
            config: {googleApiKey: 'key', geminiProModel: 'model'} as any,
            botId: 999,
            session: {history: []} as any,
            isImplicit: false,
            cleanedText: ''
        };
    });

    it('should execute successfully and reply', async () => {
        await command.execute(mockContext);
        expect(mockCallAI).toHaveBeenCalled();
        expect((command as any).reply).toHaveBeenCalledWith(
            expect.anything(),
            'Summary',
            undefined,
            expect.anything()
        );
    });

    it('should log multiple messages correctly', async () => {
        const messages = [
            {message_id: 401, chat: {id: 123}},
            {message_id: 402, chat: {id: 123}}
        ];
        (command as any).reply.mockResolvedValue(messages);

        const aiResult = {text: 'Summary', parts: [{text: 'Summary'}]};
        mockCallAI.mockResolvedValue(aiResult);

        await command.execute(mockContext);

        expect(mockLogMessage).toHaveBeenCalledTimes(2);

        expect(mockLogMessage).toHaveBeenNthCalledWith(1,
            messages[0],
            999,
            CommandType.SUMMARIZE,
            {parts: aiResult.parts}
        );

        expect(mockLogMessage).toHaveBeenNthCalledWith(2,
            messages[1],
            999,
            CommandType.SUMMARIZE,
            {linkedMessageId: 401}
        );
    });
});
