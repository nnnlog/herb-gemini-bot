import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {CommandContext} from '../../src/commands/BaseCommand.js';
import {HelpCommand} from '../../src/commands/HelpCommand.js';

describe('HelpCommand', () => {
    let command: HelpCommand;
    let mockRegistry: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    beforeEach(() => {
        mockRegistry = {
            getCommands: jest.fn().mockReturnValue([
                {
                    name: 'test',
                    aliases: ['t'],
                    description: 'test command',
                    showInList: true,
                    parameters: [],
                    matches: (name: string) => name === 'test' || name === 't'
                },
                {
                    name: 'hidden',
                    aliases: ['h'],
                    description: 'hidden command',
                    showInList: false,
                    matches: (name: string) => name === 'hidden'
                },
                {
                    name: 'image',
                    aliases: ['img'],
                    description: 'image command',
                    showInList: true,
                    parameters: [{name: 'res', type: 'string', description: 'resolution'}],
                    matches: (name: string) => name === 'image' || name === 'img'
                }
            ])
        };

        command = new HelpCommand(mockRegistry);
        (command as any).reply = jest.fn<any>().mockResolvedValue([]);

        mockBot = {} as unknown as TelegramBot;
        mockContext = {
            sender: mockBot as any,
            msg: {chat: {id: 123}} as TelegramBot.Message,
            commandName: 'help',
            args: {},
            config: {} as any,
            botId: 999,
            session: {} as any,
            isImplicit: false,
            cleanedText: ''
        };
    });

    it('should list all visible commands when no argument provided', async () => {
        mockContext.cleanedText = '';
        await command.execute(mockContext);

        expect((command as any).reply).toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('/test - test command')
        );
        expect((command as any).reply).not.toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('/hidden')
        );
    });

    it('should show detail for specific command', async () => {
        mockContext.cleanedText = 'image';
        await command.execute(mockContext);

        expect((command as any).reply).toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('/image')
        );
        expect((command as any).reply).toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('resolution')
        );
    });

    it('should show error for unknown command', async () => {
        mockContext.cleanedText = 'unknown';
        await command.execute(mockContext);

        expect((command as any).reply).toHaveBeenCalledWith(
            mockContext,
            expect.stringContaining('알 수 없는 명령어')
        );
    });
});
