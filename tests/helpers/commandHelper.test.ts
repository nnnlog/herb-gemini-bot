import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';

// Mocks
const mockGetConversationHistory = jest.fn();
const mockBuildContents = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
    getConversationHistory: mockGetConversationHistory,
    logMessage: jest.fn(),
}));

jest.unstable_mockModule('../../src/helpers/utils.js', () => ({
    buildContents: mockBuildContents,
}));

describe('Command Helper', () => {
    let commandHelper: typeof import('../../src/helpers/commandHelper.js');
    let mockBot: TelegramBot;

    beforeEach(async () => {
        commandHelper = await import('../../src/helpers/commandHelper.js');
        mockBot = {
            sendMessage: jest.fn(),
        } as unknown as TelegramBot;
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('prepareContentForModel', () => {
        it('should return error if prompt is empty after parameter stripping', async () => {
            const commandMsg = {
                chat: {id: 123},
                text: '/img 4k',
                message_id: 1,
            } as TelegramBot.Message;

            mockGetConversationHistory.mockResolvedValue([]);

            // Simulate buildContents returning an empty part for the command message
            // because "4k" was stripped and there was no other text.
            mockBuildContents.mockResolvedValue({
                contents: [{role: 'user', parts: []}], // Empty parts
                totalSize: 0
            });

            const mockSession = {
                getHistory: jest.fn().mockResolvedValue([])
            } as any;

            const result = await commandHelper.prepareContentForModel(
                mockBot,
                commandMsg,
                [],
                'image',
                mockSession,
                ['image', 'img']
            );

            expect(result.error).toBeDefined();
            expect(result.error!.message).toBe('프롬프트로 삼을 유효한 메시지가 없습니다.');
        });

        it('should return contents if prompt is valid', async () => {
            const commandMsg = {
                chat: {id: 123},
                text: '/img 4k cat',
                message_id: 1,
            } as TelegramBot.Message;

            mockGetConversationHistory.mockResolvedValue([]);

            mockBuildContents.mockResolvedValue({
                contents: [{role: 'user', parts: [{text: 'cat'}]}],
                totalSize: 0
            });

            const mockSession = {
                getHistory: jest.fn().mockResolvedValue([])
            } as any;

            const result = await commandHelper.prepareContentForModel(
                mockBot,
                commandMsg,
                [],
                'image',
                mockSession,
                ['image', 'img']
            );

            expect(result.error).toBeUndefined();
            expect(result.contents).toHaveLength(1);
            expect(result.contents![0].parts[0].text).toBe('cat');
        });
    });
});
