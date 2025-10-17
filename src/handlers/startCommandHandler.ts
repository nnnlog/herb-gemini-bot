import TelegramBot from 'node-telegram-bot-api';
import { logMessage } from '../services/db.js';
import { commands } from '../commands.js';

export async function handleStartCommand(
    msg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    bot: TelegramBot,
    BOT_ID: number
): Promise<void> {
    const commandList = commands
        .filter(cmd => cmd.type !== 'start') // start 명령어는 제외
        .map(cmd => `- \`/${cmd.aliases[0]}\`: ${cmd.description}`)
        .join('\n');

    const helpText = `
안녕하세요! Gemini Bot 입니다.

**명령어:**
${commandList}

**활용:**
- 사진이나 글에 답장하며 대화하듯이 명령을 내릴 수 있습니다.
- 봇의 응답에 답장하면 명령어 없이 대화를 이어갈 수 있습니다.
- 채팅 기록을 바탕으로 전체 대화의 맥락을 이해합니다.
- 앨범(여러 사진)을 첨부하여 명령을 내릴 수 있습니다.
`;

    const sentMsg = await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
    logMessage(sentMsg, BOT_ID, 'start');
}
