import {jest, describe, it, expect, beforeEach, afterEach} from '@jest/globals';
import type TelegramBot from 'node-telegram-bot-api';
import type {Config} from '../../src/config.js';

// --- Mock Setup ---

jest.useFakeTimers();

// Mock dependencies before doing anything else
jest.unstable_mockModule('../../src/handlers/commandRouter.js', () => ({
    routeCommand: jest.fn(),
}));
jest.unstable_mockModule('../../src/services/db.js', () => ({
    logMessage: jest.fn(),
}));

// --- Test Suite ---
describe('Media Group Handler', () => {
    let mediaGroupHandler: typeof import('../../src/handlers/mediaGroupHandler.js');
    let mockRouteCommand: jest.Mock;
    const mockBot = {} as TelegramBot;
    const mockConfig = {} as Config;
    const mockBotUsername = 'testbot'; // 테스트용 봇 사용자명 추가
    let setTimeoutSpy: jest.SpiedFunction<typeof setTimeout>;
    let clearTimeoutSpy: jest.SpiedFunction<typeof clearTimeout>;

    const createMockMediaMessage = (id: number, mediaGroupId: string, caption?: string): TelegramBot.Message => ({
        message_id: id,
        chat: {id: -100, type: 'supergroup'},
        from: {id: 123, is_bot: false, first_name: 'Test'},
        date: Date.now() / 1000,
        media_group_id: mediaGroupId,
        caption: caption,
        photo: [{file_id: `photo_${id}`, file_unique_id: `unique_${id}`}],
    } as unknown as TelegramBot.Message);

    beforeEach(async () => {
        // Reset modules to clear state (like mediaGroupCache) before each test
        jest.resetModules();

        // Re-import modules after resetting
        mediaGroupHandler = await import('../../src/handlers/mediaGroupHandler.js');
        const commandRouter = await import('../../src/handlers/commandRouter.js');
        mockRouteCommand = commandRouter.routeCommand as jest.Mock;

        // Spy on timers
        setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    });

    afterEach(() => {
        // Restore all mocks and timers
        jest.restoreAllMocks();
    });

    it('시나리오 4.1: 미디어 그룹이 아닌 단일 메시지는 즉시 routeCommand로 전달되어야 합니다.', async () => {
        const singleMsg: TelegramBot.Message = {
            message_id: 1,
            text: 'Hello',
            chat: {id: -100, type: 'supergroup'},
            from: {id: 123, is_bot: false, first_name: 'Test'},
            date: Date.now() / 1000,
        };
        await mediaGroupHandler.processMessage(singleMsg, mockBot, 999, mockConfig, mockBotUsername);
        expect(mockRouteCommand).toHaveBeenCalledTimes(1);
        expect(mockRouteCommand).toHaveBeenCalledWith(singleMsg, [], mockBot, 999, mockConfig, mockBotUsername);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('시나리오 5.1 & 5.2: 미디어 그룹 메시지들은 그룹화되어 타이머 종료 후 한 번만 처리되어야 합니다.', async () => {
        const msg1 = createMockMediaMessage(1, 'album1');
        const msg2 = createMockMediaMessage(2, 'album1');

        await mediaGroupHandler.processMessage(msg1, mockBot, 999, mockConfig, mockBotUsername);
        expect(mockRouteCommand).not.toHaveBeenCalled();
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

        await mediaGroupHandler.processMessage(msg2, mockBot, 999, mockConfig, mockBotUsername);
        expect(mockRouteCommand).not.toHaveBeenCalled();
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(2);

        await jest.runAllTimersAsync();

        expect(mockRouteCommand).toHaveBeenCalledTimes(1);
        expect(mockRouteCommand).toHaveBeenCalledWith(msg1, [msg2], mockBot, 999, mockConfig, mockBotUsername);
    });

    it('시나리오 4.3: 미디어 그룹 내에 캡션 명령어가 있으면, 해당 메시지가 commandMsg가 되어야 합니다.', async () => {
        const msg1 = createMockMediaMessage(1, 'album2');
        const msgWithCaption = createMockMediaMessage(2, 'album2', '/image a cat');
        const msg3 = createMockMediaMessage(3, 'album2');

        await mediaGroupHandler.processMessage(msg1, mockBot, 999, mockConfig, mockBotUsername);
        await mediaGroupHandler.processMessage(msgWithCaption, mockBot, 999, mockConfig, mockBotUsername);
        await mediaGroupHandler.processMessage(msg3, mockBot, 999, mockConfig, mockBotUsername);

        await jest.runAllTimersAsync();

        expect(mockRouteCommand).toHaveBeenCalledTimes(1);
        expect(mockRouteCommand.mock.calls[0][0]).toBe(msgWithCaption);
        expect(mockRouteCommand.mock.calls[0][1]).toEqual(expect.arrayContaining([msg1, msg3]));
        expect(mockRouteCommand.mock.calls[0][5]).toBe(mockBotUsername);
    });

    it('시나리오 4.4: 미디어 그룹 내에 캡션이 없으면, 첫 번째 메시지가 commandMsg가 되어야 합니다.', async () => {
        const msg1 = createMockMediaMessage(1, 'album3');
        const msg2 = createMockMediaMessage(2, 'album3');

        await mediaGroupHandler.processMessage(msg1, mockBot, 999, mockConfig, mockBotUsername);
        await mediaGroupHandler.processMessage(msg2, mockBot, 999, mockConfig, mockBotUsername);

        await jest.runAllTimersAsync();

        expect(mockRouteCommand).toHaveBeenCalledTimes(1);
        expect(mockRouteCommand.mock.calls[0][0]).toBe(msg1);
        expect(mockRouteCommand.mock.calls[0][1]).toEqual([msg2]);
        expect(mockRouteCommand.mock.calls[0][5]).toBe(mockBotUsername);
    });

    it('시나리오 5.3: 서로 다른 미디어 그룹은 독립적으로 처리되어야 합니다.', async () => {
        const msgA1 = createMockMediaMessage(1, 'albumA');
        const msgA2 = createMockMediaMessage(2, 'albumA');
        const msgB1 = createMockMediaMessage(3, 'albumB');

        await mediaGroupHandler.processMessage(msgA1, mockBot, 999, mockConfig, mockBotUsername);
        await mediaGroupHandler.processMessage(msgB1, mockBot, 999, mockConfig, mockBotUsername);
        await mediaGroupHandler.processMessage(msgA2, mockBot, 999, mockConfig, mockBotUsername);

        await jest.runAllTimersAsync();

        expect(mockRouteCommand).toHaveBeenCalledTimes(2);
        expect(mockRouteCommand).toHaveBeenCalledWith(msgA1, [msgA2], expect.any(Object), 999, mockConfig, mockBotUsername);
        expect(mockRouteCommand).toHaveBeenCalledWith(msgB1, [], expect.any(Object), 999, mockConfig, mockBotUsername);
    });
});
