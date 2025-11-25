export interface ParameterOptions {
    allowedValues: string[];
    caseSensitive?: boolean;
}

export interface ParsedResult {
    cleanedText: string;
    parameters: string[];
}

export function parseCommandParameters(text: string, options: ParameterOptions): ParsedResult {
    const {allowedValues, caseSensitive = false} = options;
    const tokens = text.trim().split(/\s+/);
    const parameters: string[] = [];
    let consumedCount = 0;

    for (const token of tokens) {
        let match: string | undefined;

        if (caseSensitive) {
            if (allowedValues.includes(token)) {
                match = token;
            }
        } else {
            // Case-insensitive matching: find the canonical value from allowedValues
            match = allowedValues.find(val => val.toLowerCase() === token.toLowerCase());
        }

        if (match) {
            parameters.push(match);
            consumedCount++;
        } else {
            // Stop parsing at the first non-matching token
            break;
        }
    }

    // Reconstruct the text without the consumed parameters
    // We need to be careful to preserve the original spacing of the remaining text if possible,
    // but since we split by whitespace, we might lose exact spacing.
    // However, for the purpose of prompts, trimming leading whitespace is usually desired.
    // A more robust way to remove parameters is to find where the non-parameter text starts.

    // Let's find the index in the original text where the first non-parameter token starts.
    // This is a bit tricky with split(/\s+/).
    // Alternative: regex replacement for the start of the string.

    let remainingText = text;
    for (const param of parameters) {
        // Create a regex that matches the parameter at the start of the string, followed by whitespace
        // We need to escape special characters in param if any (though for 1k, 2k, 4k it's fine)
        // Using a loop to remove them one by one allows us to handle the exact sequence found.

        // We need to match the *original* token that was found, not the canonical 'match'.
        // But we don't have the original token easily unless we keep track of it.
        // Let's use the tokens array we created.
    }

    // Better approach: Re-join the remaining tokens.
    // This loses original whitespace formatting (e.g. double spaces become single),
    // but for AI prompts this is generally acceptable or even preferred.

    const remainingTokens = tokens.slice(consumedCount);
    const cleanedText = remainingTokens.join(' ');

    return {
        cleanedText,
        parameters
    };
}
