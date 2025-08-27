import { GoogleGenAI } from '@google/genai';
import * as util from "node:util";

const MAX_RETRIES = 3;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function generateFromHistory(modelName, request, googleApiKey) {
    const genAI = new GoogleGenAI(googleApiKey);
    genAI.models.list().then(res => console.log(util.inspect(res, false, null, true)));

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`'${modelName}' 모델로 콘텐츠 생성 시도 (${attempt}/${MAX_RETRIES})...`);
            console.log(util.inspect(request.contents, false, null, true));

            const result = await genAI.models.generateContent({
                model: modelName,
                ...request, // { contents, config } 객체를 여기서 펼쳐서 전달
            });

            const finishReason = result.candidates?.[0]?.finishReason;
            if (finishReason === 'PROHIBITED_CONTENT' || finishReason === 'SAFETY') {
                return { error: '요청하신 내용은 안전 정책에 따라 생성할 수 없습니다. 🧐' };
            }

            const outputImages = result.candidates.map(candidate => {
                const imagePart = candidate.content?.parts?.find(part => part.inlineData);
                if (!imagePart) return null;
                return {
                    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
                    mimeType: imagePart.inlineData.mimeType,
                };
            }).filter(Boolean);

            if (outputImages.length > 0) {
                return { images: outputImages };
            }

            const textPart = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textPart) {
                return { text: textPart };
            }

            console.error("API 응답에 이미지 또는 텍스트 데이터가 없습니다.", JSON.stringify(result, null, 2));
            return { error: 'API가 인식할 수 없는 응답을 반환했습니다.' };

        } catch (error) {
            if (error.message?.includes('"code":500') && attempt < MAX_RETRIES) {
                console.warn(`API 500 오류 발생. ${attempt + 1}번째 시도를 위해 1초 대기합니다.`);
                await delay(1000);
            } else {
                console.error(`API 연동 중 최종 오류 발생 (시도 ${attempt}/${MAX_RETRIES}):`, error);
                return { error: 'API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
            }
        }
    }
}