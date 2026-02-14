import TelegramBot from 'node-telegram-bot-api';
import {BaseCommand, CommandContext} from '../commands/BaseCommand.js';
import {Config} from '../config.js';
import {isUserAuthorized} from '../services/auth.js';
import {getMessageMetadata, logMessage} from '../services/db.js';
import {SessionManager} from './SessionManager.js';

import {CommandRegistry} from './CommandRegistry.js';

export class CommandDispatcher implements CommandRegistry {
    private commands: Map<string, BaseCommand> = new Map();
    private sessionManager: SessionManager;
    private bot: TelegramBot;
    private config: Config;
    private botUsername: string = '';

    private botId: number = 0;

    constructor(bot: TelegramBot, sessionManager: SessionManager, config: Config) {
        this.bot = bot;
        this.sessionManager = sessionManager;
        this.config = config;


    }

    public setBotUsername(username: string) {
        this.botUsername = username;
    }

    public setBotId(id: number) {
        this.botId = id;
    }

    public register(command: BaseCommand) {
        this.commands.set(command.name, command);
        command.aliases.forEach(alias => this.commands.set(alias, command));
    }

    public getCommands(): BaseCommand[] {
        // 중복되지 않는 명령어 반환
        return Array.from(new Set(this.commands.values()));
    }

    public async dispatch(msg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = []) {
        if (!msg.from || !isUserAuthorized(msg.chat.id, msg.from.id)) {
            logMessage(msg, this.botId);
            return;
        }

        const botId = this.botId;
        const text = msg.text || msg.caption || '';

        let command: BaseCommand | undefined;
        let commandName = '';
        let args: Record<string, any> = {};
        let cleanedText = '';
        let isImplicit = false;

        const sortedAliases = Array.from(this.commands.keys()).sort((a, b) => b.length - a.length);

        for (const alias of sortedAliases) {
            const regex = new RegExp(`^/(${alias})(?:@${this.botUsername})?(?:\\s+|$)`, 'i');
            const match = text.match(regex);

            if (match) {
                command = this.commands.get(alias);
                commandName = alias;
                const rawArgs = text.substring(match[0].length).trim();

                if (command) {
                    const parsed = this.parseArguments(rawArgs, command);
                    args = parsed.args;
                    cleanedText = parsed.cleanedText;
                }
                break;
            }
        }

        // 2. 암시적 파싱 (답장 컨텍스트)
        if (!command && msg.reply_to_message?.from?.id === botId) {
            const originalMsgMeta = await getMessageMetadata(msg.chat.id, msg.reply_to_message.message_id);
            if (originalMsgMeta?.command_type) {
                const type = originalMsgMeta.command_type;
                const LEGACY_COMMAND_MAPPING: {[key: string]: string} = {
                    'summarize': 'gemini',
                };
                let targetCommandName = LEGACY_COMMAND_MAPPING[type] || type;

                command = this.commands.get(targetCommandName);
                if (command) {
                    commandName = targetCommandName;
                    isImplicit = true;

                    const parsed = this.parseArguments(text, command);
                    args = parsed.args;
                    cleanedText = parsed.cleanedText;

                    console.log(`'${type}' 대화의 연속으로 판단하여 응답합니다.`);
                }
            }
        }

        if (!command) {
            logMessage(msg, botId);
            return;
        }

        logMessage(msg, botId, command.name);

        const session = await this.sessionManager.getSessionContext(msg.chat.id, msg);

        const ctx: CommandContext = {
            msg,
            bot: this.bot,
            config: this.config,
            session,
            args,
            commandName,
            cleanedText,
            isImplicit,
            botId
        };

        if (await command.validate(ctx)) {
            await command.execute(ctx);
        }
    }

    private parseArguments(text: string, command: BaseCommand): {args: Record<string, any>, cleanedText: string} {
        const args: Record<string, any> = {};
        const cleanedTextParts: string[] = [];

        if (command.parameters && command.parameters.length > 0) {
            const tokens = text.split(/\s+/);
            const usedIndices = new Set<number>();

            // 기본값 설정
            command.parameters.forEach(param => {
                if (param.defaultValue !== undefined) {
                    args[param.name] = param.defaultValue;
                }
            });

            // 파싱
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

            // 재구성
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
}
