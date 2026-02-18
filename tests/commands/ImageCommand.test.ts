import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {CommandContext} from '../../src/commands/BaseCommand.js';

const mockCallAI = jest.fn<any>();
const mockLogMessage = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getConversationHistory: jest.fn<any>().mockResolvedValue([]),
    getMessage: jest.fn<any>().mockResolvedValue(null),
}));

describe('ImageCommand', () => {
    let ImageCommand: any;
    let command: any;
    let mockBot: TelegramBot;
    let mockContext: CommandContext;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module = await import('../../src/commands/ImageCommand.js');
        ImageCommand = module.ImageCommand;

        mockCallAI.mockResolvedValue({
            text: 'Here is your image',
            images: [{buffer: Buffer.from('img'), mimeType: 'image/png'}]
        });

        command = new ImageCommand();
        (command as any).callAI = mockCallAI;
        (command as any).buildPrompt = jest.fn<any>().mockResolvedValue({contents: [{parts: [{text: 'drawing of a cat'}]}]});
        (command as any).reply = jest.fn<any>().mockResolvedValue([{message_id: 100}]);
        (command as any).handleError = jest.fn<any>();

        mockBot = {setMessageReaction: jest.fn()} as unknown as TelegramBot;
        mockContext = {
            bot: mockBot,
            msg: {message_id: 1, chat: {id: 123}} as TelegramBot.Message,
            commandName: 'image',
            args: {resolution: '4k'},
            config: {googleApiKey: 'key'} as any,
            botId: 999,
            session: {history: []} as any,
            isImplicit: false,
            cleanedText: ''
        };
    });

    it('should generate image with valid response', async () => {
        await command.execute(mockContext);

        expect(mockCallAI).toHaveBeenCalled();
        expect((command as any).reply).toHaveBeenCalledWith(
            expect.anything(),
            'Here is your image',
            undefined,
            expect.arrayContaining([expect.objectContaining({mimeType: 'image/png'})])
        );
    });

    it('should default resolution to 1k if not provided', async () => {
        mockContext.args = {};
        await command.execute(mockContext);
        expect(mockCallAI).toHaveBeenCalled();
    });

    it('should log multiple messages correctly', async () => {
        const messages = [
            {message_id: 201, chat: {id: 123}},
            {message_id: 202, chat: {id: 123}}
        ];
        (command as any).reply.mockResolvedValue(messages);

        const aiResult = {
            text: 'Here is your image',
            images: [{buffer: Buffer.from('img'), mimeType: 'image/png'}],
            parts: [{text: 'Here is your image'}]
        };
        mockCallAI.mockResolvedValue(aiResult);

        await command.execute(mockContext);

        expect(mockLogMessage).toHaveBeenCalledTimes(2);
        
        expect(mockLogMessage).toHaveBeenNthCalledWith(1, 
            messages[0], 
            999, 
            'image', 
            {parts: aiResult.parts}
        );

        expect(mockLogMessage).toHaveBeenNthCalledWith(2, 
            messages[1], 
            999, 
            'image', 
            {linkedMessageId: 201}
        );
    });
});

