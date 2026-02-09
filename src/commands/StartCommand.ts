import {CommandRegistry} from '../managers/CommandRegistry.js';
import {BaseCommand, CommandContext} from './BaseCommand.js';

export class StartCommand extends BaseCommand {
    public readonly name = 'start';
    public readonly aliases = ['start'];
    public readonly description = '봇을 시작하고 간단한 도움말을 표시합니다.';
    public readonly showInList = false;

    private registry: CommandRegistry;

    constructor(registry: CommandRegistry) {
        super();
        this.registry = registry;
    }

    public async execute(ctx: CommandContext): Promise<void> {
        const commands = this.registry.getCommands();
        let helpText = `반갑습니다! Gemini AI 봇입니다. 🤖\n\n<b>사용 가능한 명령어:</b>\n`;

        commands.filter(cmd => cmd.showInList).forEach(cmd => {
            helpText += `/${cmd.name} - ${cmd.description}\n`;
        });

        helpText += `\n명령어를 입력하거나, 궁금한 점을 자연스럽게 물어보세요!`;

        await this.reply(ctx, helpText);
    }
}
