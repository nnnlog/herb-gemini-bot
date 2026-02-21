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
        setMyCommands: mockSetMyCommands
    }))
}));


describe('bot.ts reaction logic', () => {
    let messageReactionHandler: any;

    beforeAll(async () => {
        // Load bot module only once, capture the registered message_reaction handler.
        // It's IIFE inside bot.ts, so importing it runs the registration code.
        await import('../src/bot.js');

        // Extract the handler from mockOn
        const calls = mockOn.mock.calls;
        for (const call of calls) {
            if (call[0] === 'message_reaction') {
                messageReactionHandler = call[1];
                break;
            }
        }

        if (!messageReactionHandler) {
            throw new Error("message_reaction handler not found.");
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Since bot.js logic runs once and initializes BOT_ID = 123
    });

    it('should ignore duplicated reactions for the same message simultaneously', async () => {
        expect(messageReactionHandler).toBeDefined();

        const chatId = 111;
        const targetMsgId = 222;
        const originalMsgId = 333;

        const reactionEvent = {
            user: {is_bot: false},
            chat: {id: chatId},
            message_id: targetMsgId,
            new_reaction: [{type: 'emoji', emoji: '👍'}]
        };

        const targetMsg = {
            from: {id: 123}, // Same as BOT_ID from mockGetMe
            reply_to_message: {message_id: originalMsgId}
        };

        const originalMsg = {
            message_id: originalMsgId,
            text: 'original request'
        };

        let getMessageCallCount = 0;
        mockGetMessage.mockImplementation(async (cId: number, mId: number) => {
            getMessageCallCount++;
            // Simulate processing time where the lock protects against duplicate calls
            await new Promise(resolve => setTimeout(resolve, 50));
            if (mId === targetMsgId) return targetMsg;
            if (mId === originalMsgId) return originalMsg;
            return null;
        });

        // 'error: ...' 유형의 메타데이터 반환
        mockGetMessageMetadata.mockResolvedValue({command_type: CommandType.ERROR});

        // Fire 3 simultaneous reactions
        const p1 = messageReactionHandler(reactionEvent);
        const p2 = messageReactionHandler(reactionEvent);
        const p3 = messageReactionHandler(reactionEvent);

        await Promise.all([p1, p2, p3]);

        // Each full execution calls getMessage twice (targetMsg, originalMsg).
        // Without lock, it would be called 6 times.
        // With lock, it's called 2 times.
        expect(getMessageCallCount).toBe(2);

        // And dispatch should only be called once.
        expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should not retry if the target message is not an error message', async () => {
        const chatId = 111;
        const targetMsgId = 444;
        const originalMsgId = 555;

        const reactionEvent = {
            user: {is_bot: false},
            chat: {id: chatId},
            message_id: targetMsgId,
            new_reaction: [{type: 'emoji', emoji: '👍'}]
        };

        const targetMsg = {
            from: {id: 123},
            reply_to_message: {message_id: originalMsgId},
        };

        mockGetMessage.mockImplementation(async (cId: number, mId: number) => {
            if (mId === targetMsgId) return targetMsg;
            return null;
        });

        // 정상 메시지 메타데이터 반환 ('gemini' 등)
        mockGetMessageMetadata.mockResolvedValue({command_type: CommandType.GEMINI});

        await messageReactionHandler(reactionEvent);

        // 에러 메시지가 아니므로 getMessage는 targetMsg를 가져오기 위해 1번만 호출되어야 함 (originalMsg 조회 x)
        expect(mockGetMessage).toHaveBeenCalledTimes(1);
        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
