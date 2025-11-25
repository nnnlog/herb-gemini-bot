import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {GenerationOutput} from '../../src/services/aiHandler.js';

// --- Mock Setup ---
const mockLogMessage = jest.fn();
const mockSendLongMessage = jest.fn();

// Mocking ESM modules
jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: mockLogMessage
}));

jest.unstable_mockModule('../../src/helpers/utils.js', () => ({
    sendLongMessage: mockSendLongMessage
}));

// Import module under test AFTER mocking
const {handleGeminiResponse} = await import('../../src/helpers/responseHelper.js');
const db = await import('../../src/services/db.js');
const utils = await import('../../src/helpers/utils.js');

describe('responseHelper', () => {
    let bot: TelegramBot;
    let mockMessage: TelegramBot.Message;
    const BOT_ID = 12345;
    const REPLY_TO_ID = 67890;

    beforeEach(() => {
        const mockSentMessage = {
            message_id: 111,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        } as TelegramBot.Message;

        bot = {
            sendMessage: jest.fn().mockResolvedValue(mockSentMessage),
            sendMediaGroup: jest.fn().mockResolvedValue([mockSentMessage]),
            sendPhoto: jest.fn().mockResolvedValue(mockSentMessage),
            sendDocument: jest.fn().mockResolvedValue(mockSentMessage),
        } as unknown as TelegramBot;

        mockMessage = {
            chat: {id: 999},
            from: {id: 888}
        } as TelegramBot.Message;

        jest.clearAllMocks();
        mockLogMessage.mockClear();
        mockSendLongMessage.mockClear();
    });

    it('should handle error in result', async () => {
        const result: GenerationOutput = {error: 'Some error'};
        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID);

        expect(bot.sendMessage).toHaveBeenCalledWith(999, '응답 생성 실패: Some error', {reply_to_message_id: REPLY_TO_ID});
        expect(mockLogMessage).toHaveBeenCalledWith(expect.anything(), BOT_ID, 'error');
    });

    it('should handle text response', async () => {
        const result: GenerationOutput = {
            parts: [{text: 'Hello world'}],
            text: 'Hello world'
        };
        const msg1 = {
            message_id: 555,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        } as TelegramBot.Message;

        mockSendLongMessage.mockResolvedValue([msg1]);

        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID);

        // sendLongMessage가 호출되었고 images는 undefined
        expect(mockSendLongMessage).toHaveBeenCalledWith(bot, 999, 'Hello world', REPLY_TO_ID, undefined);
        expect(mockLogMessage).toHaveBeenCalledWith(expect.anything(), BOT_ID, 'chat', {parts: result.parts});
    });

    it('should handle image response (single image)', async () => {
        const result: GenerationOutput = {
            images: [{buffer: Buffer.from('fake_image'), mimeType: 'image/png'}],
            parts: [{text: 'Image caption'}],
            text: 'Image caption'
        };
        const msg1 = {
            message_id: 555,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        } as TelegramBot.Message;

        mockSendLongMessage.mockResolvedValue([msg1]);

        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID, 'image');

        // sendLongMessage가 images와 함께 호출됨
        expect(mockSendLongMessage).toHaveBeenCalledWith(
            bot,
            999,
            'Image caption',
            REPLY_TO_ID,
            result.images
        );

        // 원본 파일 전송 (sendDocument)
        expect(bot.sendDocument).toHaveBeenCalled();

        // logMessage 호출: 
        // 1. Main message (from sendLongMessage) with parts
        // 2. Document message (linked to main message)
        expect(mockLogMessage).toHaveBeenCalledTimes(2);

        // Check first call (Main message)
        expect(mockLogMessage).toHaveBeenNthCalledWith(1, msg1, BOT_ID, 'image', {parts: result.parts});

        // Check second call (Document message) - should be linked
        // We need to capture the document message returned by mock
        // bot.sendDocument returns a promise resolving to a message
        // In beforeEach, it resolves to mockSentMessage (id 111)
        expect(mockLogMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({message_id: 111}), BOT_ID, 'image', {linkedMessageId: 555});
    });

    it('should handle image response (multiple images)', async () => {
        const result: GenerationOutput = {
            images: [
                {buffer: Buffer.from('img1'), mimeType: 'image/png'},
                {buffer: Buffer.from('img2'), mimeType: 'image/png'}
            ],
            parts: [{text: 'Album caption'}],
            text: 'Album caption'
        };

        const msg1 = {message_id: 555, chat: {id: 999}} as TelegramBot.Message;
        const msg2 = {message_id: 556, chat: {id: 999}} as TelegramBot.Message;

        // sendLongMessage returns multiple messages (e.g. media group)
        mockSendLongMessage.mockResolvedValue([msg1, msg2]);

        // Mock sendMediaGroup to return document messages
        const docMsg1 = {message_id: 601, chat: {id: 999}} as TelegramBot.Message;
        const docMsg2 = {message_id: 602, chat: {id: 999}} as TelegramBot.Message;
        (bot.sendMediaGroup as jest.Mock).mockResolvedValue([docMsg1, docMsg2]);

        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID, 'image');

        // sendLongMessage가 images와 함께 호출됨
        expect(mockSendLongMessage).toHaveBeenCalledWith(
            bot,
            999,
            'Album caption',
            REPLY_TO_ID,
            result.images
        );

        // 원본 파일 전송 (sendMediaGroup for documents)
        expect(bot.sendMediaGroup).toHaveBeenCalledTimes(1);

        // logMessage calls:
        // 1. msg1 (Main) -> parts
        // 2. msg2 (Secondary photo) -> linked to msg1
        // 3. docMsg1 (Document) -> linked to msg1
        // 4. docMsg2 (Document) -> linked to msg1
        expect(mockLogMessage).toHaveBeenCalledTimes(4);

        expect(mockLogMessage).toHaveBeenNthCalledWith(1, msg1, BOT_ID, 'image', {parts: result.parts});
        expect(mockLogMessage).toHaveBeenNthCalledWith(2, msg2, BOT_ID, 'image', {linkedMessageId: 555});
        expect(mockLogMessage).toHaveBeenNthCalledWith(3, docMsg1, BOT_ID, 'image', {linkedMessageId: 555});
        expect(mockLogMessage).toHaveBeenNthCalledWith(4, docMsg2, BOT_ID, 'image', {linkedMessageId: 555});
    });

    it('should handle empty response', async () => {
        const result: GenerationOutput = {};
        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID);

        expect(bot.sendMessage).toHaveBeenCalledWith(999, '모델이 텍스트 응답을 생성하지 않았습니다.', {reply_to_message_id: REPLY_TO_ID});
        expect(mockLogMessage).toHaveBeenCalledWith(expect.anything(), BOT_ID, 'error');
    });
});
