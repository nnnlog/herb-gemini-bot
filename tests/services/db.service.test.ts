import { jest, describe, it, expect, beforeEach } from '@jest/globals';
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
  let logMessage: (msg: TelegramBot.Message, botId: number) => Promise<void>;
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

  const createMockMessage = (id: number, text: string, from: {id: number, is_bot: boolean}, replyTo?: TelegramBot.Message): TelegramBot.Message => ({
    message_id: id,
    chat: { id: -100, type: 'supergroup' },
    from: { ...from, first_name: 'Test' },
    date: Date.now() / 1000,
    text: text,
    reply_to_message: replyTo,
  } as TelegramBot.Message);

  describe('logMessage', () => {
    it('시나리오 A.1: 기본 텍스트 메시지를 raw_messages 테이블에 저장해야 합니다.', async () => {
      const msg = createMockMessage(1, 'Hello', {id: 123, is_bot: false});
      await logMessage(msg, 999);
      // initDb calls run four times, logMessage calls it again
      expect(mockDb.run).toHaveBeenCalledTimes(5);
    });
   });

  describe('getConversationHistory', () => {
    const user = { id: 123, is_bot: false };
    const bot = { id: 999, is_bot: true };

    it('시나리오 B.1: 기본 답장 체인을 올바른 순서의 대화 기록으로 변환해야 합니다.', async () => {
      const msg1 = createMockMessage(1, '안녕', user);
      const msg2 = createMockMessage(2, '안녕하세요', bot, msg1);
      const msg3 = createMockMessage(3, '오늘 날씨 어때?', user, msg2);

      mockDb.get.mockImplementation((_sql, params, callback) => {
        const id = Array.isArray(params) ? params[1] : params;
        process.nextTick(() => {
          if (id === 1) callback(null, { data: JSON.stringify(msg1) });
          else if (id === 2) callback(null, { data: JSON.stringify(msg2) });
          else callback(null, null);
        });
        return mockDb;
      });

      const history = await getConversationHistory(-100, msg3);

      expect(history).toHaveLength(3);
      expect(history[0]!.role).toBe('user');
      expect(history[1]!.role).toBe('model');
      expect(history[2]!.role).toBe('user');
      expect(mockDb.get).toHaveBeenCalledTimes(1);
    });
  });
});
