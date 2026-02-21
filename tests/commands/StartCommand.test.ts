import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {CommandContext} from '../../src/commands/BaseCommand.js';

const mockLogMessage = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getConversationHistory: jest.fn<any>().mockResolvedValue([]),
    getMessage: jest.fn<any>().mockResolvedValue(null),
}));

describe('StartCommand', () => {
    let StartCommand: any;
    let command: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    let mockRegistry: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module = await import('../../src/commands/StartCommand.js');
        StartCommand = module.StartCommand;

        mockRegistry = {
            getCommands: jest.fn().mockReturnValue([
                {name: 'test', description: 'desc', showInList: true},
                {name: 'hidden', description: 'hidden', showInList: false}
            ])
        };

        command = new StartCommand(mockRegistry);
        (command as any).reply = jest.fn<any>().mockResolvedValue([]);

        mockBot = {} as unknown as TelegramBot;
        mockContext = {
            sender: mockBot as any,
            msg: {chat: {id: 123}} as TelegramBot.Message,
            commandName: 'start',
            args: {},
            config: {} as any,
            botId: 999,
            session: {} as any,
            isImplicit: false,
            cleanedText: ''
        };
    });

    it('should reply with welcome message', async () => {
        await command.execute(mockContext);
        expect((command as any).reply).toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('반갑습니다')
        );
    });
});

