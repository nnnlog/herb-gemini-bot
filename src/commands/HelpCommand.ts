import {CommandRegistry} from '../managers/CommandRegistry.js';
import {BaseCommand, CommandContext} from './BaseCommand.js';

export class HelpCommand extends BaseCommand {
    public readonly name = 'help';
    public readonly aliases = ['help'];
    public readonly description = '도움말을 표시합니다.';
    public readonly showInList = true;

    private registry: CommandRegistry;

    constructor(registry: CommandRegistry) {
        super();
        this.registry = registry;
    }

    public async execute(ctx: CommandContext): Promise<void> {
        const {args} = ctx;
        const commands = this.registry.getCommands();

        // 특정 명령어에 대한 도움말 요청 (예: /help image)
        if (ctx.cleanedText) {
            const targetCmdName = ctx.cleanedText.split(' ')[0].toLowerCase();
            const targetCmd = commands.find(cmd => cmd.matches(targetCmdName));

            if (targetCmd) {
                let detail = `<b>/${targetCmd.name}</b>\n${targetCmd.description}\n`;
                if (targetCmd.aliases.length > 1) {
                    detail += `별칭: ${targetCmd.aliases.join(', ')}\n`;
                }
                if (targetCmd.parameters && targetCmd.parameters.length > 0) {
                    detail += `\n<b>매개변수:</b>\n`;
                    targetCmd.parameters.forEach(param => {
                        detail += `- ${param.name} (${param.type}): ${param.description || ''}`;
                        if (param.defaultValue) detail += ` (기본값: ${param.defaultValue})`;
                        if (param.allowedValues) detail += ` [${param.allowedValues.join(', ')}]`;
                        detail += '\n';
                    });
                }
                await this.reply(ctx, detail);
                return;
            } else {
                await this.reply(ctx, `알 수 없는 명령어입니다: ${targetCmdName}`);
                return;
            }
        }

        // 전체 명령어 목록
        let helpText = "<b>사용 가능한 명령어:</b>\n\n";
        commands.filter(cmd => cmd.showInList).forEach(cmd => {
            helpText += `/${cmd.name} - ${cmd.description}\n`;
        });

        helpText += "\n/help [명령어] 를 입력하면 자세한 사용법을 볼 수 있습니다.";

        await this.reply(ctx, helpText);
    }
}
