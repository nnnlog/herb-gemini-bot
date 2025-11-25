import {describe, expect, it} from '@jest/globals';
import {parseCommandParameters} from '../../src/helpers/parameterHelper.js';

describe('parseCommandParameters', () => {
    const resolutionOptions = {
        allowedValues: ['1k', '2k', '4k'],
        caseSensitive: false
    };

    it('should parse a valid parameter at the start', () => {
        const result = parseCommandParameters('1k a cute cat', resolutionOptions);
        expect(result.parameters).toEqual(['1k']);
        expect(result.cleanedText).toBe('a cute cat');
    });

    it('should parse a valid parameter with different casing', () => {
        const result = parseCommandParameters('4K a futuristic city', resolutionOptions);
        expect(result.parameters).toEqual(['4k']); // Should return canonical value
        expect(result.cleanedText).toBe('a futuristic city');
    });

    it('should return undefined parameter if none found', () => {
        const result = parseCommandParameters('a cute cat', resolutionOptions);
        expect(result.parameters).toEqual([]);
        expect(result.cleanedText).toBe('a cute cat');
    });

    it('should handle multiple spaces', () => {
        const result = parseCommandParameters('  2k    a   dog  ', resolutionOptions);
        expect(result.parameters).toEqual(['2k']);
        expect(result.cleanedText).toBe('a dog');
    });

    it('should handle newlines', () => {
        const result = parseCommandParameters('\n4k\na blue sky', resolutionOptions);
        expect(result.parameters).toEqual(['4k']);
        expect(result.cleanedText).toBe('a blue sky');
    });

    it('should stop parsing at the first non-matching token', () => {
        const result = parseCommandParameters('1k 2k invalid 4k', resolutionOptions);
        // Assuming we only want one, but the logic supports multiple sequential ones.
        // Based on "Stop parsing at the first non-matching token":
        expect(result.parameters).toEqual(['1k', '2k']);
        expect(result.cleanedText).toBe('invalid 4k');
    });

    it('should handle empty string', () => {
        const result = parseCommandParameters('', resolutionOptions);
        expect(result.parameters).toEqual([]);
        expect(result.cleanedText).toBe('');
    });

    it('should handle string with only parameter', () => {
        const result = parseCommandParameters('1k', resolutionOptions);
        expect(result.parameters).toEqual(['1k']);
        expect(result.cleanedText).toBe('');
    });
});
