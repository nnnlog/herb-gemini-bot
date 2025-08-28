import {GoogleGenAI} from '@google/genai';
import * as util from "node:util";

const MAX_RETRIES = 3;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function generateFromHistory(modelName, request, googleApiKey) {
    const genAI = new GoogleGenAI(googleApiKey);
    console.log(util.inspect(request, false, null, true));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`'${modelName}' 모델로 콘텐츠 생성 시도 (${attempt}/${MAX_RETRIES})...`);

            const result = await genAI.models.generateContent({
                model: modelName,
                ...request,
            });

            const finishReason = result.candidates?.[0]?.finishReason;
            if (finishReason === 'PROHIBITED_CONTENT' || finishReason === 'SAFETY') {
                return {error: '요청하신 내용은 안전 정책에 따라 생성할 수 없습니다. 🧐'};
            }

            console.log(util.inspect(result.candidates, false, null, true));

            const outputImages = result.candidates.map(candidate => {
                const imagePart = candidate.content?.parts?.find(part => part.inlineData);
                if (!imagePart) return null;
                return {
                    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
                    mimeType: imagePart.inlineData.mimeType,
                };
            }).filter(Boolean);

            if (outputImages.length > 0) {
                return {images: outputImages};
            }

            // 모델이 Tool을 사용한 복잡한 응답(executableCode, codeExecutionResult 등 포함)에 대응하기 위해
            // parts 배열 전체에서 text 속성을 가진 부분을 모두 찾아 결합합니다.
            const parts = result.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                const textContent = parts
                    .filter(part => typeof part.text === 'string')
                    .map(part => part.text)
                    .join('');

                if (textContent) return { text: textContent };
            }

            console.error("API 응답에 이미지 또는 텍스트 데이터가 없습니다.", JSON.stringify(result, null, 2));
            return {error: 'API가 인식할 수 없는 응답을 반환했습니다.'};

        } catch (error) {
            const errorMessage = error.message || '';

            // 💥 수정: 에러 코드에 따라 다른 재시도 간격 적용
            if (errorMessage.includes('"code":503') && attempt < MAX_RETRIES) {
                console.warn(`API 503 오류(모델 과부하) 발생. 5초 후 ${attempt + 1}번째 시도를 합니다.`);
                await delay(5000); // 5초 대기
            } else if (error.message?.includes('"code":500') && attempt < MAX_RETRIES) {
                console.warn(`API 500 오류(내부 서버) 발생. 1초 후 ${attempt + 1}번째 시도를 합니다.`);
                await delay(1000); // 1초 대기
            } else {
                console.error(`API 연동 중 최종 오류 발생 (시도 ${attempt}/${MAX_RETRIES}):`, error);
                // 사용자에게 조금 더 친절한 오류 메시지를 전달하기 위해 파싱 시도
                try {
                    const parsedError = JSON.parse(errorMessage.substring(errorMessage.indexOf('{')));
                    const finalMessage = parsedError?.error?.message || 'API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
                    return {error: finalMessage};
                } catch (e) {
                    return {error: 'API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'};
                }
            }
        }
    }
}