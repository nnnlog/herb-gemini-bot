import { Command } from './types.js';
import { handleImageCommand } from './handlers/imageCommandHandler.js';
import { handleChatCommand } from './handlers/chatCommandHandler.js';
import { handleSummarizeCommand } from './handlers/summarizeCommandHandler.js';
import { handleStartCommand } from './handlers/startCommandHandler.js';

export const commands: Command[] = [
    {
        type: 'start',
        handler: handleStartCommand,
        description: '봇을 시작하고 도움말을 표시합니다.',
        aliases: ['start'],
        showInList: false
    },
    {
        type: 'image',
        handler: handleImageCommand,
        description: '프롬프트를 기반으로 이미지를 생성합니다.',
        aliases: ['image', 'img'],
        showInList: true
    },
    {
        type: 'chat',
        handler: handleChatCommand,
        description: 'Gemini 2.5 Pro 모델과 대화합니다.',
        aliases: ['gemini', 'g'],
        showInList: true
    },
    {
        type: 'summarize',
        handler: handleSummarizeCommand,
        description: '제공된 텍스트나 대화 내용을 요약합니다.',
        aliases: ['summarize'],
        showInList: true
    }
];

export const commandMap = new Map<string, Command>();
commands.forEach(cmd => {
    cmd.aliases.forEach(alias => {
        commandMap.set(alias, cmd);
    });
});
