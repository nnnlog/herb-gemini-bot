import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';

// --- Mock Setup ---
const mockDb = {
    run: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null));
        return mockDb;
    }),
    get: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null, undefined));
        return mockDb;
    }),
    all: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null, []));
        return mockDb;
    }),
    serialize: jest.fn((callback) => {
        if (callback) process.nextTick(callback);
        return mockDb;
    }),
};

// Mock the sqlite3 module to handle the CJS/ESM default import issue
jest.unstable_mockModule('sqlite3', () => ({
    default: {
        Database: jest.fn(() => mockDb),
    },
    Database: jest.fn(() => mockDb),
}));


// --- Test Suite ---
describe('DB Service', () => {
    let logMessage: (msg: TelegramBot.Message, botId: number, commandType?: string | null, metadata?: {parts?: any[]}) => Promise<void>;
    let getConversationHistory: (chatId: number, msg: TelegramBot.Message) => Promise<any[]>;
    let initDb: () => void;

    beforeEach(async () => {
        // Dynamically import the module under test after mocks are set up
        const dbModule = await import('../../src/services/db.js');
        logMessage = dbModule.logMessage;
        getConversationHistory = dbModule.getConversationHistory;
        initDb = dbModule.initDb;

        // Clear all mock history before each test
        jest.clearAllMocks();

        // Initialize the database, which will use our mocks
        initDb();
    });

    const createMockMessage = (id: number, text: string, from: {
        id: number,
        is_bot: boolean
    }, replyTo?: TelegramBot.Message): TelegramBot.Message => ({
        message_id: id,
        chat: {id: -100, type: 'supergroup'},
        from: {...from, first_name: 'Test'},
        date: Date.now() / 1000,
        text: text,
        reply_to_message: replyTo,
    } as TelegramBot.Message);

    describe('logMessage', () => {
        it('시나리오 A.1: 기본 텍스트 메시지를 raw_messages 테이블에 저장해야 합니다.', async () => {
            const msg = createMockMessage(1, 'Hello', {id: 123, is_bot: false});
            await logMessage(msg, 999);
            // initDb calls run 8 times (5 tables + 2 indexes + 1 alter table), logMessage calls it once
            expect(mockDb.run).toHaveBeenCalledTimes(9);
        });

        it('시나리오 A.2: 메타데이터(parts)가 있는 경우 model_response_metadata 테이블에 저장해야 합니다.', async () => {
            const msg = createMockMessage(2, 'Generated Image', {id: 999, is_bot: true});
            const parts = [{text: 'thought'}, {inlineData: {mimeType: 'image/png', data: '...'}}];
            await logMessage(msg, 999, 'image', {parts});

            // initDb(8) + raw(1) + attachments(0) + message_metadata(1) + model_response_metadata(1) = 11
            expect(mockDb.run).toHaveBeenCalledTimes(11);
            const lastCall = (mockDb.run as jest.Mock).mock.calls[10] as any[];
            expect(lastCall[0]).toContain('INSERT OR REPLACE INTO model_response_metadata');
            expect(lastCall[1][2]).toBe(JSON.stringify(parts));
        });
        it('시나리오 A.3: linkedMessageId가 있는 경우 model_response_metadata 테이블에 저장해야 합니다.', async () => {
            const msg = createMockMessage(3, 'Linked Message', {id: 999, is_bot: true});
            await logMessage(msg, 999, 'chat', {linkedMessageId: 100});

            // initDb(8) + raw(1) + attachments(0) + message_metadata(1) + model_response_metadata(1) = 11
            expect(mockDb.run).toHaveBeenCalledTimes(11);
            const lastCall = (mockDb.run as jest.Mock).mock.calls[10] as any[];
            expect(lastCall[0]).toContain('INSERT OR REPLACE INTO model_response_metadata');
            // params: [chat_id, message_id, parts, linked_message_id]
            expect(lastCall[1][3]).toBe(100);
        });
    });

    describe('getConversationHistory', () => {
        const user = {id: 123, is_bot: false};
        const bot = {id: 999, is_bot: true};

        it('시나리오 B.1: 기본 답장 체인을 올바른 순서의 대화 기록으로 변환해야 합니다.', async () => {
            const msg1 = createMockMessage(1, '안녕', user);
            const msg2 = createMockMessage(2, '안녕하세요', bot, msg1);
            const msg3 = createMockMessage(3, '오늘 날씨 어때?', user, msg2);

            mockDb.get.mockImplementation((_sql, params, callback) => {
                const id = Array.isArray(params) ? params[1] : params;
                process.nextTick(() => {
                    if (typeof _sql === 'string' && _sql.includes('model_response_metadata')) {
                        callback(null, null); // No parts for these messages
                    } else {
                        if (id === 1) callback(null, {data: JSON.stringify(msg1)});
                        else if (id === 2) callback(null, {data: JSON.stringify(msg2)});
                        else callback(null, null);
                    }
                });
                return mockDb;
            });

            const history = await getConversationHistory(-100, msg3);

            expect(history).toHaveLength(3);
            expect(history[0]!.role).toBe('user');
            expect(history[1]!.role).toBe('model');
            expect(history[2]!.role).toBe('user');
            expect(history[2]!.role).toBe('user');
            // getMessage calls + getModelResponseParts calls
            expect(mockDb.get).toHaveBeenCalledTimes(4);
        });

        it('시나리오 B.2: 저장된 parts가 있으면 대화 기록에 포함되어야 합니다.', async () => {
            const msg1 = createMockMessage(1, 'Image Prompt', user);
            const msg2 = createMockMessage(2, 'Generated Content', bot, msg1);
            const parts = [{text: 'thought process'}, {text: 'final response'}];

            mockDb.get.mockImplementation((_sql, params, callback) => {
                const id = Array.isArray(params) ? params[1] : params;
                process.nextTick(() => {
                    if (typeof _sql === 'string' && _sql.includes('model_response_metadata')) {
                        if (id === 2) callback(null, {parts: JSON.stringify(parts)});
                        else callback(null, null);
                    } else {
                        if (id === 1) callback(null, {data: JSON.stringify(msg1)});
                        else if (id === 2) callback(null, {data: JSON.stringify(msg2)});
                        else callback(null, null);
                    }
                });
                return mockDb;
            });

            const history = await getConversationHistory(-100, msg2);

            expect(history).toHaveLength(2);
            expect(history[0]!.role).toBe('user');
            expect(history[1]!.role).toBe('model');
            expect(history[1]!.parts).toEqual(parts);
        });

        it('시나리오 B.3: 링크된 메시지 ID가 있는 경우 원본 메시지의 parts를 가져와야 합니다.', async () => {
            const msg1 = createMockMessage(1, 'Image Prompt', user);
            const msg2 = createMockMessage(2, 'Main Image', bot, msg1);
            const msg3 = createMockMessage(3, 'Linked Image', bot, msg1); // Same prompt, but technically linked to msg2
            // In reality, msg3 might not reply to msg1 directly in TG structure if it's a media group, 
            // but here we are testing getConversationHistory starting from a reply to msg3.

            const msg4 = createMockMessage(4, 'Reply to Linked', user, msg3);

            const parts = [{text: 'main thought'}];

            mockDb.get.mockImplementation((_sql, params, callback) => {
                const id = Array.isArray(params) ? params[1] : params;
                process.nextTick(() => {
                    if (typeof _sql === 'string' && _sql.includes('model_response_metadata')) {
                        if (id === 2) callback(null, {parts: JSON.stringify(parts)});
                        else if (id === 3) callback(null, {linked_message_id: 2}); // msg3 links to msg2
                        else callback(null, null);
                    } else {
                        if (id === 1) callback(null, {data: JSON.stringify(msg1)});
                        else if (id === 2) callback(null, {data: JSON.stringify(msg2)});
                        else if (id === 3) callback(null, {data: JSON.stringify(msg3)});
                        else callback(null, null);
                    }
                });
                return mockDb;
            });

            const history = await getConversationHistory(-100, msg4);

            // History: msg1 -> msg3 (linked to msg2) -> msg4
            // msg3 should have parts from msg2
            expect(history).toHaveLength(3);
            expect(history[1]!.role).toBe('model');
            expect(history[1]!.text).toBe('Linked Image');
            expect(history[1]!.parts).toEqual(parts);
        });
    });
});
