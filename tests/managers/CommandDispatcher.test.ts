import {jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {BaseCommand} from '../../src/commands/BaseCommand.js';
import {Config} from '../../src/config.js';
import {CommandDispatcher} from '../../src/managers/CommandDispatcher.js'; // Note .js extension for ESM

// --- Mocks ---
// We use unstable_mockModule for ESM support as per existing tests
const mockIsUserAuthorized = jest.fn();
jest.unstable_mockModule('../../src/services/auth.js', () => ({
    isUserAuthorized: mockIsUserAuthorized,
}));

const mockLogMessage = jest.fn();
const mockGetMessageMetadata = jest.fn();
jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage,
    getMessageMetadata: mockGetMessageMetadata,
    getConversationHistory: jest.fn().mockResolvedValue([])
}));

// Mock SessionManager
const mockSessionManager = {
    getSessionContext: jest.fn(),
    createSession: jest.fn()
};
jest.unstable_mockModule('../../src/managers/SessionManager.js', () => ({
    SessionManager: jest.fn(() => mockSessionManager)
}));

// Mock Bot
const mockBot = {
    sendMessage: jest.fn().mockResolvedValue({message_id: 123}),
    getMe: jest.fn().mockResolvedValue({id: 123, username: 'TestBot'}),
    setMessageReaction: jest.fn()
} as unknown as TelegramBot;

// Mock Command
class MockCommand extends BaseCommand {
    public name = 'mock';
    public aliases = ['m'];
    public description = 'Mock command';
    public execute = jest.fn();
}

// Import code under test using dynamic import after mocks
const {CommandDispatcher: DispatcherClass} = await import('../../src/managers/CommandDispatcher.js');

describe('CommandDispatcher', () => {
    let dispatcher: CommandDispatcher;
    let config: Config;
    let mockCommand: MockCommand;

    beforeEach(() => {
        jest.clearAllMocks();
        mockIsUserAuthorized.mockReturnValue(true);

        config = {
            telegramToken: 'test',
            googleApiKey: 'test',
            imageModelName: 'test',
            geminiProModel: 'test',
            allowedChannelIds: [],
            trustedUserIds: ['12345']
        };

        dispatcher = new DispatcherClass(mockBot, mockSessionManager as any, config);
        dispatcher.setBotId(123456);
        dispatcher.setBotUsername('TestBot');

        mockCommand = new MockCommand();
        dispatcher.register(mockCommand);
    });

    it('should not dispatch if user is not authorized', async () => {
        mockIsUserAuthorized.mockReturnValue(false);
        const msg = {chat: {id: 1}, from: {id: 999}, text: '/mock'} as TelegramBot.Message;

        await dispatcher.dispatch(msg);

        expect(mockLogMessage).toHaveBeenCalled();
        expect(mockCommand.execute).not.toHaveBeenCalled();
    });

    it('should dispatch explicit command /mock', async () => {
        const msg = {chat: {id: 1}, from: {id: 1}, text: '/mock args'} as TelegramBot.Message;

        await dispatcher.dispatch(msg);

        expect(mockCommand.execute).toHaveBeenCalledWith(expect.objectContaining({
            commandName: 'mock',
            args: expect.anything()
        }));
    });

    it('should dispatch alias /m', async () => {
        const msg = {chat: {id: 1}, from: {id: 1}, text: '/m args'} as TelegramBot.Message;

        await dispatcher.dispatch(msg);

        expect(mockCommand.execute).toHaveBeenCalledWith(expect.objectContaining({
            commandName: 'm'
        }));
    });

    it('should ignore command for another bot /mock@otherbot', async () => {
        const msg = {chat: {id: 1}, from: {id: 1}, text: '/mock@otherbot'} as TelegramBot.Message;

        await dispatcher.dispatch(msg);

        expect(mockCommand.execute).not.toHaveBeenCalled();
    });

    it('should accept command for this bot /mock@TestBot', async () => {
        const msg = {chat: {id: 1}, from: {id: 1}, text: '/mock@TestBot'} as TelegramBot.Message;

        await dispatcher.dispatch(msg);

        expect(mockCommand.execute).toHaveBeenCalled();
    });

    it('should handle implicit command via reply (previous command type)', async () => {
        // Setup metadata to return 'mock' as command type
        mockGetMessageMetadata.mockResolvedValue({command_type: 'mock'});

        const replyMsg = {
            message_id: 2,
            chat: {id: 1},
            from: {id: 1},
            text: 'reply text',
            reply_to_message: {
                message_id: 1,
                from: {id: 123456} // Bot ID
            }
        } as TelegramBot.Message;

        await dispatcher.dispatch(replyMsg);

        expect(mockCommand.execute).toHaveBeenCalledWith(expect.objectContaining({
            isImplicit: true
        }));
    });

    it('should default to chat command if implicit match fails? (Or handle accordingly)', async () => {
        // The current implementation might default to 'start' or log error if no command found.
        // Let's assume standard behavior: if explicit parsing fails, and implicit fails (no metadata), it does nothing/logs.
        mockGetMessageMetadata.mockResolvedValue(null);

        const msg = {chat: {id: 1}, from: {id: 1}, text: 'random text'} as TelegramBot.Message;
        await dispatcher.dispatch(msg);

        expect(mockCommand.execute).not.toHaveBeenCalled();
    });
});
