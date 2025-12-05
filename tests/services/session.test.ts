import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';

// Mocks
const mockGetConversationHistory = jest.fn();
const mockLogMessage = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    getConversationHistory: mockGetConversationHistory,
    logMessage: mockLogMessage,
}));

describe('Session Service', () => {
    let Session: any;
    let mockMsg: TelegramBot.Message;

    beforeEach(async () => {
        const module = await import('../../src/services/session.js');
        Session = module.Session;
        mockMsg = {
            chat: {id: 123},
            message_id: 456
        } as TelegramBot.Message;
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should call getConversationHistory with correct arguments', async () => {
        mockGetConversationHistory.mockResolvedValue([] as never);
        await Session.create(123, mockMsg);

        expect(mockGetConversationHistory).toHaveBeenCalledWith(123, mockMsg);
    });

    it('should return the history from property', async () => {
        const mockHistory = [{role: 'user', text: 'hello'}];
        mockGetConversationHistory.mockResolvedValue(mockHistory as never);

        const session = await Session.create(123, mockMsg);

        expect(session.history).toEqual(mockHistory);
    });

    it('should return correct commandType', async () => {
        const mockHistory = [{role: 'user', text: '/image cat'}];
        mockGetConversationHistory.mockResolvedValue(mockHistory as never);

        const session = await Session.create(123, mockMsg);

        expect(session.commandType).toBe('image');
    });

    it('should return null commandType if no history', async () => {
        mockGetConversationHistory.mockResolvedValue([] as never);
        const session = await Session.create(123, mockMsg);
        expect(session.commandType).toBeNull();
    });

    it('should return empty options', async () => {
        mockGetConversationHistory.mockResolvedValue([] as never);
        const session = await Session.create(123, mockMsg);
        expect(session.options).toEqual({});
    });
});
