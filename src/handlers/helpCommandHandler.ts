import {CommandHandler} from '../types.js';

const helpMessage = `*Gemini 텔레그램 봇 도움말*

이 봇은 Google의 Gemini AI를 활용하여 다양한 기능을 제공합니다.

*주요 기능*
- \`/help\`: 이 도움말을 표시합니다.
- \`/gemini\` (별칭: \`/g\`): Gemini 3.0 Pro 모델과 대화합니다. 메시지를 보내거나, 봇의 메시지에 답장하여 대화를 이어갈 수 있습니다.
- \`/map\`: Google 지도 기능이 활성화된 상태로 Gemini 3.0 Pro 모델과 대화합니다. 위치 기반 질문이나 길찾기 등에 활용할 수 있습니다.
- \`/image\` (별칭: \`/img\`): Gemini 3.0 Pro Image 모델을 사용하여 프롬프트를 기반으로 이미지를 생성합니다. 텍스트 프롬프트와 함께 사진을 첨부하여 이미지 관련 작업을 수행할 수도 있습니다.
- \`/summarize\`: 웹 페이지 링크를 보내주시면 내용을 요약해 드립니다. 긴 텍스트나 파일에 답장하여 요약을 요청할 수도 있습니다.

*사용 방법*
- **명령어 사용**: 위에 안내된 명령어를 입력하여 특정 기능을 실행할 수 있습니다. 예: \`/image 고양이 그림\`
- **대화형 응답**: 봇이 보낸 메시지에 답장(reply)하면, 이전 대화의 맥락을 기억하여 자연스러운 대화를 이어갑니다.
- **사진 첨부**: 사진을 보내면서 메시지를 함께 입력하면, 사진을 이해하고 관련된 작업을 수행합니다. (예: 사진을 보내며 "이 사진을 설명해줘")
`;

export const handleHelpCommand: CommandHandler = async (
    msg,
    albumMessages,
    bot,
    BOT_ID,
    config,
    originalMessageId,
    parsedCommand
) => {
    await bot.sendMessage(msg.chat.id, helpMessage, {parse_mode: 'Markdown'});
};
