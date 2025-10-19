import {jest, describe, it, expect, beforeEach} from '@jest/globals';
import {isUserAuthorized} from '../../src/services/auth.js';
import {config} from '../../src/config.js';

// isUserAuthorized가 의존하는 config 모듈을 모의 처리합니다.
// 이를 통해 실제 .env 파일이나 설정 값에 구애받지 않고 테스트를 진행할 수 있습니다.
jest.mock('../../src/config.js', () => ({
    config: {
        trustedUserIds: [],
        allowedChannelIds: [],
    },
}));

// 모의 처리된 config 객체를 타입과 함께 가져옵니다.
// as jest.Mocked<T>를 사용하면 타입스크립트에게 이 객체가 모의 객체임을 알려줄 수 있습니다.
const mockedConfig = config as jest.Mocked<typeof config>;

describe('Auth Service - isUserAuthorized', () => {

    // 각 테스트 케이스가 실행되기 전에, 모의 config 값을 초기 상태로 리셋합니다.
    // 이렇게 하면 테스트들이 서로에게 영향을 주지 않습니다.
    beforeEach(() => {
        mockedConfig.trustedUserIds = [];
        mockedConfig.allowedChannelIds = [];
    });

    it('시나리오 1.1: 사용자 ID가 trustedUserIds에 포함되면 true를 반환해야 합니다.', () => {
        // 준비 (Arrange)
        mockedConfig.trustedUserIds = ['123', '456'];
        const chatId = 999; // 관련 없는 채팅 ID
        const userId = 123;   // 허용된 사용자 ID

        // 실행 (Act)
        const result = isUserAuthorized(chatId, userId);

        // 단언 (Assert)
        expect(result).toBe(true);
    });

    it('시나리오 1.2: 채팅 ID가 allowedChannelIds에 포함되면 true를 반환해야 합니다.', () => {
        // 준비 (Arrange)
        mockedConfig.allowedChannelIds = ['-1001', '-1002'];
        const chatId = -1001; // 허용된 채널 ID
        const userId = 999;   // 관련 없는 사용자 ID

        // 실행 (Act)
        const result = isUserAuthorized(chatId, userId);

        // 단언 (Assert)
        expect(result).toBe(true);
    });

    it('시나리오 1.3: 어떤 허용 목록에도 포함되지 않으면 false를 반환해야 합니다.', () => {
        // 준비 (Arrange)
        mockedConfig.trustedUserIds = ['123'];
        mockedConfig.allowedChannelIds = ['-1001'];
        const chatId = 999;   // 허용되지 않은 채널 ID
        const userId = 999;   // 허용되지 않은 사용자 ID

        // 실행 (Act)
        const result = isUserAuthorized(chatId, userId);

        // 단언 (Assert)
        expect(result).toBe(false);
    });

    it('시나리오 1.4: 설정의 허용 목록이 비어있을 때 false를 반환해야 합니다.', () => {
        // 준비 (Arrange)
        // beforeEach에서 이미 목록이 비워진 상태입니다.
        const chatId = 123;
        const userId = -1001;

        // 실행 (Act)
        const result = isUserAuthorized(chatId, userId);

        // 단언 (Assert)
        expect(result).toBe(false);
    });

    it('시나리오 1.4 (엣지 케이스): 숫자형 ID와 문자열 목록을 올바르게 비교해야 합니다.', () => {
        // 준비 (Arrange)
        mockedConfig.trustedUserIds = ['123', '456'];
        mockedConfig.allowedChannelIds = ['-1001', '-1002'];

        // 실행 및 단언 (Act & Assert)
        expect(isUserAuthorized(-999, 123)).toBe(true); // User ID 매치
        expect(isUserAuthorized(-1001, 999)).toBe(true); // Chat ID 매치
    });
});
