import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Config } from '../../src/config.js';

// Define a mock config object that can be manipulated in tests.
// Note: The IDs are strings, matching the real config structure.
const mockConfig: Partial<Config> = {
    allowedChannelIds: [],
    trustedUserIds: [],
};

// Mock the config module BEFORE importing the service that depends on it.
jest.unstable_mockModule('../../src/config.js', () => ({
    config: mockConfig,
}));

// --- Test Suite ---
describe('Authorization Service', () => {
    let isUserAuthorized: (chatId: number, userId: number) => boolean;

    // Before each test, dynamically import the module to get the version with the mock.
    beforeEach(async () => {
        const authService = await import('../../src/services/auth.js');
        isUserAuthorized = authService.isUserAuthorized;

        // Reset mock config to a default state for each test, using STRINGS for IDs.
        mockConfig.allowedChannelIds = ['12345'];
        mockConfig.trustedUserIds = ['54321'];
    });

    it('should authorize a trusted user in any chat', () => {
        const chatId = 99999; // A non-allowed channel
        const userId = 54321; // A trusted user
        expect(isUserAuthorized(chatId, userId)).toBe(true);
    });

    it('should authorize any user in an allowed channel', () => {
        const chatId = 12345; // An allowed channel
        const userId = 98765; // A non-trusted user
        expect(isUserAuthorized(chatId, userId)).toBe(true);
    });

    it('should not authorize a non-trusted user in a non-allowed channel', () => {
        const chatId = 99999; // A non-allowed channel
        const userId = 98765; // A non-trusted user
        expect(isUserAuthorized(chatId, userId)).toBe(false);
    });

    it('should authorize if trustedUserIds is empty and channel is allowed', () => {
        mockConfig.trustedUserIds = [];
        const chatId = 12345;
        const userId = 11111;
        expect(isUserAuthorized(chatId, userId)).toBe(true);
    });

    it('should not authorize if allowedChannelIds is empty and user is not trusted', () => {
        mockConfig.allowedChannelIds = [];
        const chatId = 99999;
        const userId = 11111;
        expect(isUserAuthorized(chatId, userId)).toBe(false);
    });

    it('should authorize a trusted user even if allowedChannelIds is empty', () => {
        mockConfig.allowedChannelIds = [];
        const chatId = 99999;
        const userId = 54321; // trusted user
        expect(isUserAuthorized(chatId, userId)).toBe(true);
    });

    it('should not authorize if both lists are empty', () => {
        mockConfig.allowedChannelIds = [];
        mockConfig.trustedUserIds = [];
        const chatId = 12345;
        const userId = 54321;
        expect(isUserAuthorized(chatId, userId)).toBe(false);
    });
});