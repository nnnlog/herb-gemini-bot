import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../src/config.js', () => ({
    config: {
        trustedUserIds: [],
        allowedChannelIds: [],
    },
}));

describe('Auth Service - isUserAuthorized', () => {
    let isUserAuthorized: any;
    let config: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        const configModule = await import('../../src/config.js');
        config = configModule.config;

        const authModule = await import('../../src/services/auth.js');
        isUserAuthorized = authModule.isUserAuthorized;

        config.trustedUserIds = [];
        config.allowedChannelIds = [];
    });

    it('시나리오 1.1: 사용자 ID가 trustedUserIds에 포함되면 true를 반환해야 합니다.', () => {
        config.trustedUserIds = ['123', '456'];
        const chatId = 999;
        const userId = 123;
        const result = isUserAuthorized(chatId, userId);
        expect(result).toBe(true);
    });

    it('시나리오 1.2: 채팅 ID가 allowedChannelIds에 포함되면 true를 반환해야 합니다.', () => {
        config.allowedChannelIds = ['-1001', '-1002'];
        const chatId = -1001;
        const userId = 999;
        const result = isUserAuthorized(chatId, userId);
        expect(result).toBe(true);
    });

    it('시나리오 1.3: 어떤 허용 목록에도 포함되지 않으면 false를 반환해야 합니다.', () => {
        config.trustedUserIds = ['123'];
        config.allowedChannelIds = ['-1001'];
        const chatId = 999;
        const userId = 999;
        const result = isUserAuthorized(chatId, userId);
        expect(result).toBe(false);
    });

    it('시나리오 1.4: 설정의 허용 목록이 비어있을 때 false를 반환해야 합니다.', () => {
        const chatId = 123;
        const userId = -1001;
        const result = isUserAuthorized(chatId, userId);
        expect(result).toBe(false);
    });

    it('시나리오 1.4 (엣지 케이스): 숫자형 ID와 문자열 목록을 올바르게 비교해야 합니다.', () => {
        config.trustedUserIds = ['123', '456'];
        config.allowedChannelIds = ['-1001', '-1002'];
        expect(isUserAuthorized(-999, 123)).toBe(true);
        expect(isUserAuthorized(-1001, 999)).toBe(true);
    });
});

