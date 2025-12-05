import {beforeAll, describe, expect, jest, test} from '@jest/globals';

// Mock sqlite3 to prevent DB connection side effects
jest.unstable_mockModule('sqlite3', () => ({
    default: {
        Database: jest.fn(() => ({})),
        verbose: jest.fn().mockReturnThis()
    }
}));

describe('CommandParser', () => {
    let parseMessage: (text: string, botUsername: string) => any;
    const botUsername = 'TestBot';

    beforeAll(async () => {
        const module = await import('../src/helpers/commandParser.js');
        parseMessage = module.parseMessage;
    });

    test('parses simple command', () => {
        const text = '/start';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('start');
        expect(result?.args).toEqual({});
        expect(result?.cleanedText).toBe('');
    });

    test('parses command with text', () => {
        const text = '/gemini hello world';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('chat');
        expect(result?.args).toEqual({});
        expect(result?.cleanedText).toBe('hello world');
    });

    test('parses command with alias', () => {
        const text = '/g hello';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('chat');
    });

    test('parses command with bot username', () => {
        const text = `/gemini@${botUsername} hello`;
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('chat');
        expect(result?.cleanedText).toBe('hello');
    });

    test('parses image command with resolution parameter (start)', () => {
        const text = '/image 4k cat';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('image');
        expect(result?.args).toEqual({resolution: '4k'});
        expect(result?.cleanedText).toBe('cat');
    });

    test('parses image command with resolution parameter (end)', () => {
        const text = '/image cat 2k';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('image');
        expect(result?.args).toEqual({resolution: '2k'});
        expect(result?.cleanedText).toBe('cat');
    });

    test('parses image command with default parameter', () => {
        const text = '/image cat';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('image');
        expect(result?.args).toEqual({resolution: '1k'}); // Default value
        expect(result?.cleanedText).toBe('cat');
    });

    test('parses image command with mixed case parameter', () => {
        const text = '/image 4K cat';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('image');
        expect(result?.args).toEqual({resolution: '4k'}); // Should be normalized to allowed value
        expect(result?.cleanedText).toBe('cat');
    });

    test('ignores invalid parameter values', () => {
        const text = '/image 8k cat';
        const result = parseMessage(text, botUsername);
        expect(result).not.toBeNull();
        expect(result?.command.type).toBe('image');
        expect(result?.args).toEqual({resolution: '1k'}); // Default
        expect(result?.cleanedText).toBe('8k cat'); // 8k treated as text
    });

    test('returns null for non-command', () => {
        const text = 'hello world';
        const result = parseMessage(text, botUsername);
        expect(result).toBeNull();
    });

    test('returns null for command with wrong bot username', () => {
        const text = '/gemini@OtherBot hello';
        const result = parseMessage(text, botUsername);
        expect(result).toBeNull();
    });
});
