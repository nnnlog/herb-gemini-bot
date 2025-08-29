import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type TelegramBot from 'node-telegram-bot-api';
import type { ConversationTurn } from '../../src/services/db.js';
import { Readable } from 'stream';

// --- Mock Setup ---

// 1. Mock low-level dependencies
jest.unstable_mockModule('sqlite3', () => ({
  Database: jest.fn(() => ({})),
}));

// 2. Mock direct dependencies
const mockGetConversationHistory = jest.fn();
jest.unstable_mockModule('../../src/services/db.js', () => ({
  getConversationHistory: mockGetConversationHistory,
}));

// 3. Mock node-fetch, which is a dependency of the module under test
const mockFetch = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch,
}));


// --- Test Suite ---
describe('Utils Helper', () => {
  let utils: typeof import('../../src/helpers/utils.js');
  let mockBot: TelegramBot;

  beforeEach(async () => {
    // Dynamically import the module under test AFTER mocks are set up
    utils = await import('../../src/helpers/utils.js');

    // Clear mocks
    jest.clearAllMocks();
    mockGetConversationHistory.mockClear();

    // Setup mock for node-fetch to return a fake buffer
    mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-file-data')),
    });

    // Setup mock bot with getFileStream
    mockBot = {
        sendMessage: jest.fn(),
        getFileStream: jest.fn(() => Readable.from(Buffer.from('fake-stream-data'))),
    } as unknown as TelegramBot;
    (mockBot.sendMessage as jest.Mock).mockResolvedValue({ message_id: 12345 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendLongMessage', () => {
    it('should send a single message if text is short', async () => {
      const chatId = 123;
      const shortText = 'Hello, this is a short message.';
      await utils.sendLongMessage(mockBot, chatId, shortText, 456);
      expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildContents', () => {
    const createMockCommandMessage = (text: string): TelegramBot.Message => ({
      message_id: 1,
      chat: { id: 1, type: 'private' },
      text: text,
      from: { id: 123, is_bot: false, first_name: 'Test' },
      date: Date.now() / 1000,
    } as TelegramBot.Message);

    it('should create content with only a text part for a simple text message', async () => {
      const history: ConversationTurn[] = [{ role: 'user', text: 'Hello', files: [] }];
      mockGetConversationHistory.mockResolvedValue(history);
      const commandMsg = createMockCommandMessage('Hello');

      const { contents } = await utils.buildContents(mockBot, history, commandMsg, [], 'gemini');

      expect(contents).toHaveLength(1);
      expect(contents[0]!.role).toBe('user');
      expect(contents[0]!.parts).toHaveLength(1);
      expect(contents[0]!.parts[0]).toEqual({ text: 'Hello' });
    });

    it('should create content with an inlineData part for a message with a photo', async () => {
      const history: ConversationTurn[] = [
        { role: 'user', text: 'Check this image', files: [{ file_id: 'file123', file_unique_id: 'unique123', type: 'photo' }] }
      ];
      mockGetConversationHistory.mockResolvedValue(history);
      const commandMsg = createMockCommandMessage('Check this image');

      const { contents } = await utils.buildContents(mockBot, history, commandMsg, [], 'image');

      expect(contents[0]!.parts).toHaveLength(2);
      expect(contents[0]!.parts[0]!).toHaveProperty('inlineData');
      // Assert that the underlying stream was called by getFileBuffer
      expect(mockBot.getFileStream).toHaveBeenCalledWith('file123');
    });
  });
});
