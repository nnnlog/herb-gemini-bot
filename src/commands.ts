import {Command} from './types.js';
import {handleImageCommand} from './handlers/imageCommandHandler.js';
import {handleChatCommand} from './handlers/chatCommandHandler.js';
import {handleSummarizeCommand} from './handlers/summarizeCommandHandler.js';
import {handleStartCommand} from './handlers/startCommandHandler.js';
import {handleHelpCommand} from './handlers/helpCommandHandler.js';
import {handleMapCommand} from "./handlers/mapCommandHandler.js";

export const commands: Command[] = [
    {
        type: 'start',
        handler: handleStartCommand,
        description: '봇을 시작하고 간단한 도움말을 표시합니다.',
        aliases: ['start'],
        showInList: false,
        ignoreArgs: true
    },
    {
        type: 'help',
        handler: handleHelpCommand,
        description: '자세한 도움말을 표시합니다.',
        aliases: ['help'],
        showInList: true,
        ignoreArgs: true
    },
    {
        type: 'image',
        handler: handleImageCommand,
        description: 'Gemini 2.5 Flash Image 모델로 이미지를 생성합니다.',
        aliases: ['image', 'img'],
        showInList: true
    },
    {
        type: 'chat',
        handler: handleChatCommand,
        description: 'Gemini 3.0 Pro 모델과 대화합니다.',
        aliases: ['gemini', 'g'],
        showInList: true
    },
    {
        type: 'map',
        handler: handleMapCommand,
        description: 'Google 지도 기능이 활성화된 상태로 Gemini 3.0 Pro 모델과 대화합니다.',
        aliases: ['map'],
        showInList: true
    },
    {
        type: 'summarize',
        handler: handleSummarizeCommand,
        description: '링크나 긴 텍스트(파일)를 요약합니다.',
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
