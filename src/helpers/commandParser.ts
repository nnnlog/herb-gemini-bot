import {commandMap} from '../commands.js';
import {Command, ParsedCommand} from '../types.js';

export function parseCommandArguments(text: string, command: Command): {args: Record<string, any>, cleanedText: string} {
    const args: Record<string, any> = {};
    let cleanedTextParts: string[] = [];

    if (command.parameters && command.parameters.length > 0) {
        const tokens = text.split(/\s+/);
        const usedIndices = new Set<number>();

        // Initialize defaults
        command.parameters.forEach(param => {
            if (param.defaultValue !== undefined) {
                args[param.name] = param.defaultValue;
            }
        });

        // Simple parsing strategy: Look for allowed values in tokens
        command.parameters.forEach(param => {
            if (param.allowedValues) {
                for (let i = 0; i < tokens.length; i++) {
                    if (usedIndices.has(i)) continue;

                    const token = tokens[i];
                    const match = param.allowedValues.find(v => v.toLowerCase() === token.toLowerCase());
                    if (match) {
                        args[param.name] = match;
                        usedIndices.add(i);
                        break;
                    }
                }
            }
        });

        // Reconstruct cleaned text from unused tokens
        tokens.forEach((token, index) => {
            if (!usedIndices.has(index)) {
                cleanedTextParts.push(token);
            }
        });
    } else {
        if (text) {
            cleanedTextParts.push(text);
        }
    }

    return {
        args,
        cleanedText: cleanedTextParts.join(' ')
    };
}

export function parseMessage(text: string, botUsername: string): ParsedCommand | null {
    if (!text) return null;

    // 1. Identify Command
    const sortedAliases = Array.from(commandMap.keys()).sort((a, b) => b.length - a.length);

    let matchedCommand: Command | null = null;
    let commandLength = 0;

    for (const alias of sortedAliases) {
        const regex = new RegExp(`^/(${alias})(?:@${botUsername})?(?:\\s+|$)`, 'i');
        const match = text.match(regex);
        if (match) {
            matchedCommand = commandMap.get(alias)!;
            commandLength = match[0].length;
            break;
        }
    }

    if (!matchedCommand) {
        return null;
    }

    const rawArgs = text.substring(commandLength).trim();
    const {args, cleanedText} = parseCommandArguments(rawArgs, matchedCommand);

    return {
        command: matchedCommand,
        args: args,
        cleanedText: cleanedText,
        originalText: text
    };
}
