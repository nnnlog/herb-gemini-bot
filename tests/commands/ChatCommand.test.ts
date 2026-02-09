import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {CommandContext} from '../../src/commands/BaseCommand.js';

// Mocks
const mockCallAI = jest.fn<any>();
const mockLogMessage = jest.fn<any>();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getConversationHistory: jest.fn<any>().mockResolvedValue([]),
    getMessage: jest.fn<any>().mockResolvedValue(null),
}));

describe('ChatCommand', () => {
    let ChatCommand: any;
    let command: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    beforeEach(async () => {
        jest.clearAllMocks();

        // Dynamic import to allow mocking
        const module = await import('../../src/commands/ChatCommand.js');
        ChatCommand = module.ChatCommand;

        mockCallAI.mockResolvedValue({text: 'AI Response', images: [] as any});

        command = new ChatCommand();
        // Inject mock callAI
        (command as any).callAI = mockCallAI;
        // Inject mock buildPrompt
        (command as any).buildPrompt = jest.fn<any>().mockResolvedValue({contents: [{parts: [{text: 'hi'}]}]});
        (command as any).reply = jest.fn<any>().mockResolvedValue([{message_id: 100}]);
        (command as any).handleError = jest.fn<any>();

        mockBot = {
            setMessageReaction: jest.fn<any>()
        } as unknown as TelegramBot;

        mockContext = {
            bot: mockBot,
            msg: {message_id: 1, chat: {id: 123}} as TelegramBot.Message,
            commandName: 'gemini',
            args: {},
            config: {
                geminiProModel: 'gemini-pro',
                googleApiKey: 'key'
            } as any,
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
            'AI Response',
            undefined,
            expect.anything()
        );
    });

    it('should handle errors from AI', async () => {
        mockCallAI.mockResolvedValue({error: 'Some API Error'});

        await command.execute(mockContext);

        expect((command as any).reply).toHaveBeenCalledWith(expect.anything(), 'Some API Error');
    });

    it('should handle buildPrompt errors', async () => {
        (command as any).buildPrompt.mockResolvedValue({error: 'Prompt Error'});

        await command.execute(mockContext);

        expect((command as any).reply).toHaveBeenCalledWith(expect.anything(), 'Prompt Error');
        expect(mockCallAI).not.toHaveBeenCalled();
    });

    it('should set 👍 reaction at start and clear it in finally', async () => {
        await command.execute(mockContext);

        // 첫 번째 호출: 👍 반응 설정
        expect(mockBot.setMessageReaction).toHaveBeenNthCalledWith(1, 123, 1, {
            reaction: [{type: 'emoji', emoji: '👍'}]
        });

        // 두 번째 호출: 반응 제거
        expect(mockBot.setMessageReaction).toHaveBeenNthCalledWith(2, 123, 1, {
            reaction: []
        });
    });

    it('should clear reaction even when AI returns error', async () => {
        mockCallAI.mockResolvedValue({error: 'API Error'});

        await command.execute(mockContext);

        // 마지막 호출은 반응 제거여야 함
        expect(mockBot.setMessageReaction).toHaveBeenLastCalledWith(123, 1, {
            reaction: []
        });
    });
});
