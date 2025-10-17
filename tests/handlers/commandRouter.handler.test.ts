import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type TelegramBot from 'node-telegram-bot-api';
import type { Config } from '../../src/config.js';

// --- Mock Setup ---

// 1. Mock low-level dependencies first
jest.unstable_mockModule('sqlite3', () => ({
  Database: jest.fn(() => ({})),
}));

// 2. Mock the modules that commandRouter depends on
const mockIsUserAuthorized = jest.fn();
jest.unstable_mockModule('../../src/services/auth.js', () => ({
  isUserAuthorized: mockIsUserAuthorized,
}));

const mockLogMessage = jest.fn();
const mockGetMessageMetadata = jest.fn();
const mockGetConversationHistory = jest.fn();
jest.unstable_mockModule('../../src/services/db.js', () => ({
  logMessage: mockLogMessage,
  getMessageMetadata: mockGetMessageMetadata,
  getConversationHistory: mockGetConversationHistory,
}));

const mockHandleImageCommand = jest.fn();
jest.unstable_mockModule('../../src/handlers/imageCommandHandler.js', () => ({
  handleImageCommand: mockHandleImageCommand,
}));

const mockHandleChatCommand = jest.fn();
jest.unstable_mockModule('../../src/handlers/chatCommandHandler.js', () => ({
  handleChatCommand: mockHandleChatCommand,
}));


// --- Test Suite ---
describe('Command Router', () => {
  let commandRouter: typeof import('../../src/handlers/commandRouter.js');
  let mockBot: TelegramBot;
  const mockConfig: Config = {
    telegramToken: 'test-token',
    googleApiKey: 'test-api-key',
    imageModelName: 'gemini-pro-vision',
    geminiProModel: 'gemini-pro',
    allowedChannelIds: [],
    trustedUserIds: [],
  };
  const BOT_ID = 999;
  const BOT_USERNAME = 'mybot'; // 테스트용 봇 사용자명 추가

  const createMockMessage = (id: number, text?: string, replyTo?: TelegramBot.Message, fromId = 123): TelegramBot.Message => ({
    message_id: id,
    chat: { id: -100, type: 'supergroup' },
    from: { id: fromId, is_bot: false, first_name: 'Test' },
    date: Date.now() / 1000,
    text: text,
    caption: text,
    reply_to_message: replyTo,
  } as TelegramBot.Message);

  beforeEach(async () => {
    // Dynamically import the module under test after mocks are set up
    commandRouter = await import('../../src/handlers/commandRouter.js');

    // Clear all mocks and set default behaviors
    jest.clearAllMocks();
    mockIsUserAuthorized.mockReturnValue(true);

    // Setup mock bot
    mockBot = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
      setMessageReaction: jest.fn().mockResolvedValue(true),
    } as unknown as TelegramBot;
  });

  it('should not call any handler if user is not authorized', async () => {
    mockIsUserAuthorized.mockReturnValue(false);
    const msg = createMockMessage(1, '/gemini hello');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockLogMessage).toHaveBeenCalledWith(msg, BOT_ID);
    expect(mockHandleChatCommand).not.toHaveBeenCalled();
    expect(mockHandleImageCommand).not.toHaveBeenCalled();
  });

  it('should call image command handler for /image command', async () => {
    const msg = createMockMessage(1, '/image a cat');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleImageCommand).toHaveBeenCalledWith(msg, [], mockBot, BOT_ID, mockConfig, msg.message_id);
  });

  it('should call chat command handler for /gemini@mybot command', async () => {
    const msg = createMockMessage(1, '/gemini@mybot a dog');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).toHaveBeenCalledWith(msg, [], mockBot, BOT_ID, mockConfig, msg.message_id);
  });

  it('should NOT call chat command handler for /gemini@anotherbot command', async () => {
    const msg = createMockMessage(1, '/gemini@anotherbot a dog');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).not.toHaveBeenCalled();
  });

  it('should call image command handler for /img alias', async () => {
    const msg = createMockMessage(1, '/img a cat');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleImageCommand).toHaveBeenCalledWith(msg, [], mockBot, BOT_ID, mockConfig, msg.message_id);
  });

  it('should not call chat command handler for invalid command like ...alias', async () => {
    const msg = createMockMessage(1, '...a dog');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).not.toHaveBeenCalled();
  });

  it('should use replied-to message as prompt source', async () => {
    const originalMsg = createMockMessage(1, 'This is a photo prompt');
    const commandMsg = createMockMessage(2, '/gemini', originalMsg);
    await commandRouter.routeCommand(commandMsg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).toHaveBeenCalledWith(originalMsg, [], mockBot, BOT_ID, mockConfig, commandMsg.message_id);
  });

  it('should send error message if no prompt is provided', async () => {
    const msg = createMockMessage(1, '/image');
    await commandRouter.routeCommand(msg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockBot.sendMessage).toHaveBeenCalledWith(msg.chat.id, expect.stringContaining('프롬프트를 입력'), expect.any(Object));
    expect(mockHandleImageCommand).not.toHaveBeenCalled();
  });

  it('should send error when replying to a bot message with a command only', async () => {
    const botMsg = { ...createMockMessage(1, 'This is a bot response'), from: { id: BOT_ID, is_bot: true, first_name: 'Bot' } };
    const userReply = createMockMessage(2, '/gemini', botMsg);
    await commandRouter.routeCommand(userReply, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockBot.sendMessage).toHaveBeenCalledWith(userReply.chat.id, expect.stringContaining('봇의 응답이나 다른 명령어에는'), expect.any(Object));
    expect(mockHandleChatCommand).not.toHaveBeenCalled();
  });

  it('should continue conversation by calling the correct handler', async () => {
    const botMsg = { ...createMockMessage(1, 'This is a chat response'), from: { id: BOT_ID, is_bot: true, first_name: 'Bot'} };
    const userReply = createMockMessage(2, 'Tell me more', botMsg);
    mockGetMessageMetadata.mockResolvedValue({ command_type: 'chat' } as any);
    await commandRouter.routeCommand(userReply, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).toHaveBeenCalledWith(userReply, [], mockBot, BOT_ID, mockConfig, userReply.message_id);
  });

  it('should use forwarded message as prompt source when replying with command only', async () => {
    const forwardedMsg = { ...createMockMessage(1, 'Forwarded content'), forward_from: { id: 456, is_bot: false, first_name: 'Other User' } };
    const commandMsg = createMockMessage(2, '/gemini', forwardedMsg);
    await commandRouter.routeCommand(commandMsg, [], mockBot, BOT_ID, mockConfig, BOT_USERNAME);
    expect(mockHandleChatCommand).toHaveBeenCalledWith(forwardedMsg, [], mockBot, BOT_ID, mockConfig, commandMsg.message_id);
  });
});
