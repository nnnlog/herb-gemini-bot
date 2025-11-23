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
        mockSendLongMessage.mockResolvedValue({
            message_id: 555,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        });

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
        mockSendLongMessage.mockResolvedValue({
            message_id: 555,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        });

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

        // logMessage 호출: sendLongMessage 결과 + sendDocument
        expect(mockLogMessage).toHaveBeenCalledTimes(2);
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
        mockSendLongMessage.mockResolvedValue({
            message_id: 555,
            chat: {id: 999},
            from: {id: BOT_ID},
            date: 1234567890
        });

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
        const docArgs = (bot.sendMediaGroup as jest.Mock).mock.calls[0];
        expect(docArgs[1]).toHaveLength(2);
        expect(docArgs[1][0].type).toBe('document');
    });

    it('should handle empty response', async () => {
        const result: GenerationOutput = {};
        await handleGeminiResponse(bot, mockMessage, result, BOT_ID, REPLY_TO_ID);

        expect(bot.sendMessage).toHaveBeenCalledWith(999, '모델이 텍스트 응답을 생성하지 않았습니다.', {reply_to_message_id: REPLY_TO_ID});
        expect(mockLogMessage).toHaveBeenCalledWith(expect.anything(), BOT_ID, 'error');
    });
});
