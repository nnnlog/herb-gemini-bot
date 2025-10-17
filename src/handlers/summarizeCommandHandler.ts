import {generateFromHistory, GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';
import {sendLongMessage} from '../helpers/utils.js';
import {marked} from 'marked';
import TelegramBot from "node-telegram-bot-api";
import { Config } from '../config.js';
import { GenerateContentParameters } from '@google/genai';
import { handleCommandError, prepareContentForModel } from "../helpers/commandHelper.js";
import { readFileSync } from 'fs';

const summarizePrompt = `# 역할 (Role)
당신은 모든 분야를 아우르는 **고밀도 정보 분석가**입니다. 당신의 임무는 사용자가 제공한 웹페이지(뉴스, 블로그, 보고서 등)의 내용을 분석하여, 바쁜 전문가들이 빠르게 전체 내용을 파악할 수 있는 **'GeekNews(Hada.io)' 스타일의 고밀도 정보 리포트**를 작성하는 것입니다.

# 필수 작업 절차 (MUST FOLLOW PROCEDURE)
작성 전에 반드시 다음 절차를 따르십시오.

1.  **정보 수집 (Information Gathering):**
    *   사용자가 제공한 URL의 실제 내용을 확인하기 위해 **반드시 검색/브라우징 도구를 호출**하십시오.
    *   본문을 대충 훑어보지 말고, 기사에 포함된 **육하원칙(5W1H), 구체적인 수치, 배경, 인과 관계, 인용문** 등을 꼼꼼히 파악하십시오.

2.  **검증 및 환각 방지 (Verification & Anti-Hallucination):**
    *   도구 호출 결과를 확인하십시오. 사이트에 접근할 수 없거나 유효한 콘텐츠를 가져오지 못했다면, **절대 당신의 학습된 지식으로 내용을 추측하거나 지어내지 마십시오.**
    *   이 경우, 즉시 "제공된 사이트에 접근할 수 없어 내용을 확인할 수 없습니다."라고만 출력하고 작업을 종료하십시오.

3.  **작성 (Writing):**
    *   오직 **도구를 통해 수집된 정보만을 기반**으로 아래의 [작성 가이드]에 따라 리포트를 작성하십시오.

# 작성 가이드 (Writing Guide) - GeekNews 스타일

GeekNews 스타일은 단순한 요약이 아닙니다. **독자가 원문을 읽지 않아도 될 만큼 모든 디테일을 빠짐없이 포함하되, 그 전달 방식을 극도로 압축적이고 건조한 문체로 변환한 것**입니다.

## 1. 정보의 분류 (Information Classification)
원문의 내용을 중요도와 포괄성에 따라 두 섹션으로 분류하여 작성합니다.

*   **핵심 사항 (Key Points):** 전체 내용을 관통하는 가장 중요한 상위 레벨의 핵심 정보 (결론, 주요 변경점 등).
*   **세부 사항 (Details):** 핵심 사항을 뒷받침하거나 원문에 포함된 **나머지 모든 포괄적인 정보**. 구체적 데이터, 통계, 역사적 배경, 인물 발언, 부가적인 맥락 등을 최대한 상세하고 빠짐없이 나열함. **(이 섹션의 분량이 가장 많아야 함)**

## 2. 어조 및 스타일 (Tone & Style)
- **극도의 객관성과 건조함:** 감정적 표현, 수식어, 주관적 해석을 배제하고 **사실(Fact)**만을 전달하세요.
- **[스타일 핵심] 명사형 종결:** 제목을 제외한 본문의 모든 문장(도입부, 글머리 기호 항목)은 **반드시 '명사형' 또는 '명사구'로 종결**해야 합니다. 서술형 어미(\`~다.\`, \`~했습니다.\`)는 절대 사용하지 마세요.
    - (O) ...기준금리를 0.25%p 인상함
    - (O) ...규제 준수 의무가 발생
    - (X) ...기준금리를 0.25%p 인상했습니다.

## 3. 구조 및 형식 (Structure & Format)
반드시 다음의 4단 구조를 따릅니다.

### 1. 제목 (Headline)
- 내용의 핵심 주체와 주요 사건을 한 줄로 명확하게 요약.

### 2. 도입부 (Introduction)
- 전체 내용을 아우르는 1~2문장의 압축 요약.
- **반드시 명사형으로 종결.**

### 3. 핵심 사항 (Key Points)
- 가장 중요한 뼈대 정보 3~5개 내외로 압축.
- 각 항목은 **글머리 기호(\`-\`)** 사용.
- 구조: **\`[핵심 키워드(Bold)]: [내용] + [간략한 이유/배경]\`**
- **반드시 명사형으로 종결.**

### 4. 세부 사항 (Details)
- 원문에 있는 **나머지 모든 정보를 포괄적으로 나열.**
- 수치, 인용, 배경, 전망 등 원문의 디테일을 놓치지 말고 최대한 많이 포함시킬 것.
- 각 항목은 **글머리 기호(\`-\`)** 사용.
- 구조: **\`[카테고리/토픽(Bold)]: [상세 내용 전체]\`**
- **반드시 명사형으로 종결.**

---

## 4. 예시 (Example) - 일반 주제 (경제)

**(입력된 내용이 중앙은행의 기준금리 인상 발표 뉴스일 경우의 이상적인 출력)**

---
### 중앙은행, 물가 안정을 위해 기준금리 3.50%로 0.25%p 인상 단행

중앙은행 금융통화위원회가 통화정책방향 회의를 열고, 지속되는 물가 상승 압력에 대응하기 위해 기준금리를 현행 3.25%에서 3.50%로 0.25%p 인상 결정함.

#### 핵심 사항
- **금리 인상:** 기준금리를 0.25%p 인상하여 3.50%로 결정함. 이는 2008년 이후 가장 높은 수준임
- **결정 배경:** 5%대의 높은 소비자물가 상승률이 지속됨에 따라 기대인플레이션 고착화를 막기 위한 조치
- **경제 전망:** 금리 인상 영향을 반영하여 올해 경제성장률 전망치를 1.7%에서 1.6%로 하향 조정함

#### 세부 사항
- **위원 간 표결 분포:** 금통위원 7명 중 5명이 0.25%p 인상에 찬성했으나, 2명은 경기 침체 우려 및 이자 부담 가중을 이유로 '동결' 소수의견을 제시함. 소수의견 출현은 금리 인상 사이클 종료가 임박했다는 신호로 해석됨
- **물가 지표 상세:** 지난달 소비자물가 상승률은 5.2%였으며, 근원물가 상승률도 4%대 초반을 유지 중. 전기·가스요금 등 공공요금 인상이 물가 상방 압력으로 작용하고 있음
- **한미 금리 격차:** 미국 연준(Fed)의 기준금리(4.25%~4.50%) 상단과 비교 시 금리 격차는 기존과 동일한 1.00%p~1.25%p를 유지함. 자본 유출 우려는 여전한 상황
- **총재 기자회견 발언:** "물가 안정이 최우선이나, 앞으로는 경기와 금융 안정도 함께 고려하는 정교한 정책 대응이 필요함"이라고 언급. 최종 금리 수준에 대해서는 위원 간 의견이 3.50%~3.75%로 나뉘어 있다고 밝힘
- **시장 및 분야별 영향:**
    - **채권 시장:** 금리 인상이 선반영되어 국고채 금리는 소폭 하락 마감함
    - **부동산 시장:** 주택담보대출 금리 상승으로 매수 심리가 더욱 위축되어 거래 절벽 현상이 심화될 전망
    - **가계 부채:** 변동금리 대출 비중이 높은 차주들의 이자 상환 부담이 크게 증가하여 소비 위축 요인으로 작용할 가능성
---`;

async function handleSummarizeCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'summarize');

        if (contentPreparationResult.error) {
            const sentMsg = await bot.sendMessage(chatId, contentPreparationResult.error.message, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const request: GenerateContentParameters = {
            model: config.geminiProModel!,
            contents: contentPreparationResult.contents!,
            config: {
                systemInstruction: summarizePrompt,
                tools: [
                    {googleSearch: {}},
                    {codeExecution: {}},
                    {urlContext: {}},
                ],
                thinkingConfig: {
                    thinkingBudget: 32768,
                },
                httpOptions: {
                    timeout: 120000,
                },
            }
        };

        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        if (result.error) {
            const sentMsg = await bot.sendMessage(chatId, `응답 생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        } else if (result.parts && result.parts.length > 0) {
            let fullResponse = '';
            for (const part of result.parts) {
                if (part.text) {
                    fullResponse += part.text;
                } else if (part.executableCode) {
                    const code = part.executableCode.code;
                    fullResponse += `\n\n<b>[코드 실행]</b>\n<pre><code class="language-python">${escapeHtml(code ?? '')}</code></pre>`;
                } else if (part.codeExecutionResult) {
                    const output = part.codeExecutionResult.output;
                    const outcome = part.codeExecutionResult.outcome;
                    const outcomeIcon = outcome === 'OUTCOME_OK' ? '✅' : '❌';
                    fullResponse += `\n<b>[실행 결과 ${outcomeIcon}]</b>\n<pre>${escapeHtml(output ?? '')}</pre>`;
                }
            }

            if (result.groundingMetadata) {
                const { webSearchQueries, groundingChunks } = result.groundingMetadata;
                let metadataText = '\n';

                if (webSearchQueries && webSearchQueries.length > 0) {
                    metadataText += `\n---\n🔍 **검색어**: ${webSearchQueries.map(q => `'${q}'`).join(', ' )}\n`;
                }

                if (groundingChunks && groundingChunks.length > 0) {
                    const uniqueSources = new Map<string, string>();
                    groundingChunks.forEach(chunk => {
                        if (chunk.web && chunk.web.uri && chunk.web.title) {
                            uniqueSources.set(chunk.web.uri, chunk.web.title);
                        }
                    });

                    if (uniqueSources.size > 0) {
                        metadataText += `\n📚 **출처**:\n`;
                        uniqueSources.forEach((title, uri) => {
                            metadataText += ` - [${title}](${uri})\n`;
                        });
                    }
                }
                fullResponse += metadataText;
            }

            const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(fullResponse.trim() || '') as string, replyToId);
            logMessage(sentMsg, BOT_ID, 'summarize');
        } else {
            const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        }
    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'summarize');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export {handleSummarizeCommand};
