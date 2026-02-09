import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';
import {Readable} from 'stream';
import * as utils from '../../src/helpers/utils.js';

describe('utils', () => {
    let mockBot: TelegramBot;

    beforeEach(() => {
        jest.clearAllMocks();
        mockBot = {
            getFileStream: jest.fn<any>()
        } as unknown as TelegramBot;
    });

    describe('getFileBuffer', () => {
        it('should fetch file and return buffer', async () => {
            const mockData = Buffer.from('test data');
            (mockBot.getFileStream as jest.Mock).mockReturnValue(Readable.from(mockData));

            const buffer = await utils.getFileBuffer(mockBot, 'file123');

            expect(buffer.toString()).toBe('test data');
            expect(mockBot.getFileStream).toHaveBeenCalledWith('file123');
        });

        it('should use cache for subsequent requests', async () => {
            const mockData = Buffer.from('cached data');
            (mockBot.getFileStream as jest.Mock).mockReturnValue(Readable.from(mockData));

            // First call
            await utils.getFileBuffer(mockBot, 'cached_file');
            // Second call
            const buffer = await utils.getFileBuffer(mockBot, 'cached_file');

            expect(buffer.toString()).toBe('cached data');
            expect(mockBot.getFileStream).toHaveBeenCalledTimes(1);
        });
    });
});
