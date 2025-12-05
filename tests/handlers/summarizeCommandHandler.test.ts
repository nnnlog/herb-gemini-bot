import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {Config} from '../../src/config';

// --- Mock Setup ---
const mockPrepareContentForModel = jest.fn();
const mockHandleCommandError = jest.fn();
const mockHandleGeminiResponse = jest.fn();
const mockGenerateFromHistory = jest.fn();
const mockLogMessage = jest.fn();

// Mocking ESM modules
jest.unstable_mockModule('../../src/helpers/commandHelper.js', () => ({
    prepareContentForModel: mockPrepareContentForModel,
    handleCommandError: mockHandleCommandError
}));

jest.unstable_mockModule('../../src/helpers/responseHelper.js', () => ({
    handleGeminiResponse: mockHandleGeminiResponse
}));

jest.unstable_mockModule('../../src/services/aiHandler.js', () => ({
    generateFromHistory: mockGenerateFromHistory
}));

jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage
}));

jest.unstable_mockModule('../../src/services/session.js', () => ({
    Session: {
        create: jest.fn().mockResolvedValue({
            history: []
        })
    }
}));

// Import module under test AFTER mocking
const {handleSummarizeCommand} = await import('../../src/handlers/summarizeCommandHandler.js');

describe('summarizeCommandHandler', () => {
    let bot: TelegramBot;
    let mockMessage: TelegramBot.Message;
    const BOT_ID = 12345;
    const REPLY_TO_ID = 67890;
    const config: Config = {
        geminiProModel: 'gemini-pro',
        googleApiKey: 'fake-api-key'
    } as Config;

    beforeEach(() => {
        bot = {
            sendMessage: jest.fn().mockResolvedValue({message_id: 111} as TelegramBot.Message),
            setMessageReaction: jest.fn().mockResolvedValue(true),
        } as unknown as TelegramBot;

        mockMessage = {
            chat: {id: 999},
            from: {id: 888}
        } as TelegramBot.Message;

        jest.clearAllMocks();
        mockPrepareContentForModel.mockClear();
        mockHandleCommandError.mockClear();
        mockHandleGeminiResponse.mockClear();
        mockGenerateFromHistory.mockClear();
        mockLogMessage.mockClear();
    });

    it('should handle successful generation', async () => {
        mockPrepareContentForModel.mockResolvedValue({
            contents: [{parts: [{text: 'prompt'}]}]
        });
        const mockResult = {parts: [{text: 'response'}]};
        mockGenerateFromHistory.mockResolvedValue(mockResult);

        await handleSummarizeCommand(mockMessage, [], bot, BOT_ID, config, REPLY_TO_ID);

        expect(mockPrepareContentForModel).toHaveBeenCalled();
        expect(mockGenerateFromHistory).toHaveBeenCalled();
        expect(mockHandleGeminiResponse).toHaveBeenCalledWith(
            bot, mockMessage, mockResult, BOT_ID, REPLY_TO_ID, 'summarize'
        );
    });

    it('should handle preparation error', async () => {
        mockPrepareContentForModel.mockResolvedValue({
            error: {message: 'Prep error'}
        });

        await handleSummarizeCommand(mockMessage, [], bot, BOT_ID, config, REPLY_TO_ID);

        expect(bot.sendMessage).toHaveBeenCalledWith(999, 'Prep error', {reply_to_message_id: REPLY_TO_ID});
        expect(mockLogMessage).toHaveBeenCalledWith(expect.anything(), BOT_ID, 'error');
        expect(mockGenerateFromHistory).not.toHaveBeenCalled();
    });

    it('should handle exception', async () => {
        const error = new Error('Unexpected error');
        mockPrepareContentForModel.mockRejectedValue(error);

        await handleSummarizeCommand(mockMessage, [], bot, BOT_ID, config, REPLY_TO_ID);

        expect(mockHandleCommandError).toHaveBeenCalledWith(
            error, bot, 999, REPLY_TO_ID, BOT_ID, 'summarize'
        );
    });
});
