import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import type TelegramBot from 'node-telegram-bot-api';
import {Readable} from 'stream';
import type {ConversationTurn} from '../../src/services/db.js';

// --- Mock Setup ---

// 1. Mock low-level dependencies
jest.unstable_mockModule('sqlite3', () => ({
    Database: jest.fn(() => ({})),
}));

// 2. Mock direct dependencies
const mockGetConversationHistory = jest.fn();
jest.unstable_mockModule('../../src/services/db.js', () => ({
    getConversationHistory: mockGetConversationHistory,
}));

// 3. Mock node-fetch
const mockFetch = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({
    default: mockFetch,
}));

// 4. Mock commands.js to avoid loading handlers and their dependencies (like db.js)
const mockCommandMap = new Map();
mockCommandMap.set('image', {
    type: 'image',
    parameters: [
        {
            name: 'resolution',
            type: 'string',
            allowedValues: ['1k', '2k', '4k'],
            defaultValue: '1k'
        }
    ]
});
mockCommandMap.set('gemini', {type: 'chat'});

jest.unstable_mockModule('../../src/commands.js', () => ({
    commandMap: mockCommandMap,
}));


// --- Test Suite ---
describe('Utils Helper', () => {
    let utils: typeof import('../../src/helpers/utils.js');
    let mockBot: TelegramBot;

    beforeEach(async () => {
        // Dynamically import the module under test AFTER mocks are set up
        utils = await import('../../src/helpers/utils.js');

        // Clear mocks
        jest.clearAllMocks();
        mockGetConversationHistory.mockClear();

        // Setup mock for node-fetch to return a fake buffer
        mockFetch.mockResolvedValue({
            ok: true,
            buffer: () => Promise.resolve(Buffer.from('fake-file-data')),
        });

        // Setup mock bot with getFileStream
        mockBot = {
            sendMessage: jest.fn(),
            getFileStream: jest.fn(() => Readable.from(Buffer.from('fake-stream-data'))),
        } as unknown as TelegramBot;
        (mockBot.sendMessage as jest.Mock).mockResolvedValue({message_id: 12345});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('sendLongMessage', () => {
        it('should send a single message if text is short', async () => {
            const chatId = 123;
            const shortText = 'Hello, this is a short message.';
            await utils.sendLongMessage(mockBot, chatId, shortText, 456);
            expect(mockBot.sendMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe('buildContents', () => {
        const createMockCommandMessage = (text: string): TelegramBot.Message => ({
            message_id: 1,
            chat: {id: 1, type: 'private'},
            text: text,
            from: {id: 123, is_bot: false, first_name: 'Test'},
            date: Date.now() / 1000,
        } as TelegramBot.Message);

        it('should create content with only a text part for a simple text message', async () => {
            const history: ConversationTurn[] = [{role: 'user', text: 'Hello', files: []}];
            mockGetConversationHistory.mockResolvedValue(history);
            const commandMsg = createMockCommandMessage('Hello');

            const {contents} = await utils.buildContents(mockBot, history, commandMsg, [], 'gemini');

            expect(contents).toHaveLength(1);
            expect(contents[0]!.role).toBe('user');
            expect(contents[0]!.parts).toHaveLength(1);
            expect(contents[0]!.parts[0]).toEqual({text: 'Hello'});
        });

        it('should create content with an inlineData part for a message with a photo', async () => {
            const history: ConversationTurn[] = [
                {
                    role: 'user',
                    text: 'Check this image',
                    files: [{file_id: 'file123', file_unique_id: 'unique123', type: 'photo'}]
                }
            ];
            mockGetConversationHistory.mockResolvedValue(history);
            const commandMsg = createMockCommandMessage('Check this image');

            const {contents} = await utils.buildContents(mockBot, history, commandMsg, [], 'image', ['image', 'img']);

            expect(contents[0]!.parts).toHaveLength(2);
            expect(contents[0]!.parts[0]!).toHaveProperty('inlineData');
            // Assert that the underlying stream was called by getFileBuffer
            expect(mockBot.getFileStream).toHaveBeenCalledWith('file123');
        });

        it('should use stored parts if available in conversation history', async () => {
            const parts = [{text: 'thought process'}, {text: 'final response'}];
            const history: ConversationTurn[] = [
                {
                    role: 'model',
                    text: 'response',
                    files: [],
                    parts: parts
                }
            ];
            mockGetConversationHistory.mockResolvedValue(history);
            const commandMsg = createMockCommandMessage('Next prompt');

            const {contents} = await utils.buildContents(mockBot, history, commandMsg, [], 'gemini');

            expect(contents).toHaveLength(1);
            expect(contents[0]!.role).toBe('model');
            expect(contents[0]!.parts).toEqual(parts);
            // Should NOT call getFileStream or try to rebuild parts from text/files
            expect(mockBot.getFileStream).not.toHaveBeenCalled();
        });
        it('should strip resolution parameter from text for image command', async () => {
            const history: ConversationTurn[] = [{role: 'user', text: '/img 4k cat', files: []}];
            mockGetConversationHistory.mockResolvedValue(history);
            const commandMsg = createMockCommandMessage('/img 4k cat');

            const {contents} = await utils.buildContents(mockBot, history, commandMsg, [], 'image', ['image', 'img']);

            expect(contents).toHaveLength(1);
            expect(contents[0]!.parts).toHaveLength(1);
            expect(contents[0]!.parts[0]).toEqual({text: 'cat'});
        });

        it('should handle reply with resolution parameter correctly', async () => {
            // Case: User replies to a message with "/img 4k"
            const history: ConversationTurn[] = [
                {role: 'user', text: 'draw a cat', files: []}
            ];
            mockGetConversationHistory.mockResolvedValue(history);
            const commandMsg = createMockCommandMessage('/img 4k'); // Reply text

            // Let's assume `getConversationHistory` returns the current turn including the command.
            const historyWithCommand: ConversationTurn[] = [
                {role: 'user', text: 'draw a cat', files: []},
                {role: 'user', text: '/img 4k', files: []}
            ];
            mockGetConversationHistory.mockResolvedValue(historyWithCommand);

            const {contents} = await utils.buildContents(mockBot, historyWithCommand, commandMsg, [], 'image', ['image', 'img']);

            expect(contents).toHaveLength(2);
            expect(contents[0]!.parts[0]).toEqual({text: 'draw a cat'});
            expect(contents[1]!.parts).toHaveLength(0);
        });
    });
});
