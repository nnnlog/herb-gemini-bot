import {describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {ConversationTurn} from '../../src/services/db';

// Mock sqlite3 to prevent DB connection side effects
jest.unstable_mockModule('sqlite3', () => ({
    default: {
        Database: jest.fn(() => ({})),
        verbose: jest.fn().mockReturnThis()
    }
}));

// Dynamic import for modules that might trigger DB connection
const {buildContents} = await import('../../src/helpers/utils');

// Mock TelegramBot
const mockBot = {
    getFileStream: jest.fn(),
} as unknown as TelegramBot;

describe('buildContents for Image Command', () => {
    const mockCommandMsg = {
        message_id: 100,
        date: 1234567890,
        chat: {id: 123, type: 'private'},
        from: {id: 456, is_bot: false, first_name: 'User'},
        text: '/image test prompt'
    } as TelegramBot.Message;

    const mockAlbumMessages: TelegramBot.Message[] = [];

    it('should filter out functionCall and functionResponse parts when command is image', async () => {
        const history: ConversationTurn[] = [
            {
                role: 'user',
                text: 'Calculate something',
                files: [],
                parts: [{text: 'Calculate something'}]
            },
            {
                role: 'model',
                text: '',
                files: [],
                parts: [
                    {functionCall: {name: 'calculator', args: {expression: '1+1'}}}
                ]
            },
            {
                role: 'user',
                text: '',
                files: [],
                parts: [
                    {functionResponse: {name: 'calculator', response: {result: 2}}}
                ]
            },
            {
                role: 'model',
                text: 'The answer is 2',
                files: [],
                parts: [{text: 'The answer is 2'}]
            }
        ];

        const result = await buildContents(mockBot, history, mockCommandMsg, mockAlbumMessages, 'image');

        // Expecting 3 turns:
        // 1. User text
        // 2. Model text (The answer is 2)
        // 3. Current command (User text)
        // The turns with ONLY functionCall or functionResponse should be effectively removed or empty parts if filtered.
        // Let's see how buildContents handles empty parts.

        // Wait, buildContents maps history to contents.
        // If we filter parts, some contents might have empty parts.
        // The implementation plan said: "Ensure that if a turn becomes empty after filtering, it is handled correctly"

        // Let's check the output.
        const parts = result.contents.flatMap(c => c.parts);

        const hasFunctionCall = parts.some(p => 'functionCall' in p);
        const hasFunctionResponse = parts.some(p => 'functionResponse' in p);

        expect(hasFunctionCall).toBe(false);
        expect(hasFunctionResponse).toBe(false);

        // Verify text is preserved
        const textParts = parts.filter(p => 'text' in p);
        expect(textParts.length).toBeGreaterThan(0);
        expect(textParts.some(p => p.text === 'Calculate something')).toBe(true);
        expect(textParts.some(p => p.text === 'The answer is 2')).toBe(true);
    });

    it('should keep functionCall parts when command is gemini', async () => {
        const history: ConversationTurn[] = [
            {
                role: 'model',
                text: '',
                files: [],
                parts: [
                    {functionCall: {name: 'calculator', args: {expression: '1+1'}}}
                ]
            }
        ];

        const result = await buildContents(mockBot, history, mockCommandMsg, mockAlbumMessages, 'gemini');

        const parts = result.contents.flatMap(c => c.parts);
        const hasFunctionCall = parts.some(p => 'functionCall' in p);

        expect(hasFunctionCall).toBe(true);
    });
});
