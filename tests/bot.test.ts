import {jest} from '@jest/globals';

// CommandType enum 값 (실제 소스와 동기화)
const CommandType = {
    GEMINI: 'gemini',
    IMAGE: 'image',
    MAP: 'map',
    SUMMARIZE: 'summarize',
    ERROR: 'error'
} as const;

// mock dependencies
jest.unstable_mockModule('../src/config.js', () => ({
    config: {telegramToken: 'test-token', googleApiKey: 'test-key'}
}));

const mockDispatch = jest.fn<any>();
const mockSetBotUsername = jest.fn<any>();
const mockSetBotId = jest.fn<any>();
const mockRegister = jest.fn<any>();
const mockGetCommands = jest.fn<any>().mockReturnValue([]);

jest.unstable_mockModule('../src/managers/CommandDispatcher.js', () => ({
    CommandDispatcher: jest.fn().mockImplementation(() => ({
        dispatch: mockDispatch,
        setBotUsername: mockSetBotUsername,
        setBotId: mockSetBotId,
        register: mockRegister,
        getCommands: mockGetCommands
    }))
}));

const mockSessionManager = {
    getSessionContext: jest.fn<any>()
};

jest.unstable_mockModule('../src/managers/SessionManager.js', () => ({
    sessionManager: mockSessionManager,
    SessionManager: jest.fn().mockImplementation(() => mockSessionManager)
}));

const mockGetMessage = jest.fn<any>();
const mockInitDb = jest.fn<any>();
const mockGetMessageMetadata = jest.fn<any>();
const mockLogMessage = jest.fn<any>();

jest.unstable_mockModule('../src/services/db.js', () => ({
    getMessage: mockGetMessage,
    getMessageMetadata: mockGetMessageMetadata,
    initDb: mockInitDb,
    logMessage: mockLogMessage,
    CommandType
}));

const mockGetMe = jest.fn<any>().mockResolvedValue({id: 123, username: 'test_bot'});
const mockOn = jest.fn<any>();
const mockStartPolling = jest.fn<any>().mockResolvedValue(undefined);
const mockSetMyCommands = jest.fn<any>().mockResolvedValue(undefined);

jest.unstable_mockModule('node-telegram-bot-api', () => ({
    default: jest.fn().mockImplementation(() => ({
        getMe: mockGetMe,
        on: Object.assign(mockOn, {mockClear: jest.fn()}),
        startPolling: mockStartPolling,
        setMyCommands: mockSetMyCommands,
        answerCallbackQuery: jest.fn<any>().mockResolvedValue(undefined),
        editMessageText: jest.fn<any>().mockResolvedValue(undefined),
        deleteMessage: jest.fn<any>().mockResolvedValue(undefined)
    }))
}));


describe('bot.ts retry logic via callback_query', () => {
    let callbackQueryHandler: any;

    beforeAll(async () => {
        await import('../src/bot.js');

        const calls = mockOn.mock.calls;
        for (const call of calls) {
            if (call[0] === 'callback_query') {
                callbackQueryHandler = call[1];
                break;
            }
        }

        if (!callbackQueryHandler) {
            throw new Error("callback_query handler not found.");
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should ignore duplicated callback_queries for the same message simultaneously', async () => {
        expect(callbackQueryHandler).toBeDefined();

        const chatId = 111;
        const buttonMsgId = 222;
        const originalMsgId = 333;

        const callbackQuery = {
            id: 'query1',
            data: `retry_${originalMsgId}`,
            message: { chat: { id: chatId }, message_id: buttonMsgId }
        };

        const originalMsg = {
            message_id: originalMsgId,
            text: 'original request'
        };

        let getMessageCallCount = 0;
        mockGetMessage.mockImplementation(async (cId: number, mId: number) => {
            getMessageCallCount++;
            await new Promise(resolve => setTimeout(resolve, 50));
            if (mId === originalMsgId) return originalMsg;
            return null;
        });

        const p1 = callbackQueryHandler(callbackQuery);
        const p2 = callbackQueryHandler({ ...callbackQuery, id: 'query2' });
        const p3 = callbackQueryHandler({ ...callbackQuery, id: 'query3' });

        await Promise.all([p1, p2, p3]);

        expect(getMessageCallCount).toBe(1);
        expect(mockDispatch).toHaveBeenCalledTimes(1);
        expect(mockDispatch).toHaveBeenCalledWith(originalMsg, [], buttonMsgId);
    });

    it('should not retry if the original message is not found', async () => {
        const chatId = 111;
        const buttonMsgId = 444;
        const originalMsgId = 555;

        const callbackQuery = {
            id: 'query1',
            data: `retry_${originalMsgId}`,
            message: { chat: { id: chatId }, message_id: buttonMsgId }
        };

        mockGetMessage.mockResolvedValue(null);

        await callbackQueryHandler(callbackQuery);

        expect(mockGetMessage).toHaveBeenCalledTimes(1);
        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
