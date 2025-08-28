import { GoogleGenAI, Part, GroundingMetadata, GenerateContentParameters, Candidate } from '@google/genai';

const MAX_RETRIES = 3;
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// API 응답을 감싸는 명확한 출력 타입 정의
export interface GenerationOutput {
    error?: string;
    images?: { buffer: Buffer; mimeType: string | undefined; }[];
    parts?: Part[];
    text?: string; // result.text를 직접 사용하기 위한 필드 추가
    groundingMetadata?: GroundingMetadata;
}

export async function generateFromHistory(request: GenerateContentParameters, googleApiKey: string): Promise<GenerationOutput> {
    const genAI = new GoogleGenAI({ apiKey: googleApiKey });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`'${request.model}' 모델로 콘텐츠 생성 시도 (${attempt}/${MAX_RETRIES})...`);

            const result = await genAI.models.generateContent(request);

            // 1. 프롬프트 자체가 안전 필터에 의해 차단되었는지 먼저 확인
            if (result.promptFeedback?.blockReason) {
                console.warn(`API 프롬프트 차단됨: ${result.promptFeedback.blockReason}`);
                return { error: '요청하신 내용은 안전 정책에 따라 처리할 수 없습니다.' };
            }

            const firstCandidate = result.candidates?.[0];

            // 2. 개별 후보(candidate)가 차단되었는지 확인
            if (firstCandidate?.finishReason === 'PROHIBITED_CONTENT' || firstCandidate?.finishReason === 'SAFETY') {
                return {error: '모델이 생성한 내용이 안전 정책에 따라 차단되었습니다.'};
            }

            // 3. 이미지 데이터 추출 (모든 후보에서)
            const outputImages = result.candidates?.reduce((acc: { buffer: Buffer; mimeType: string | undefined; }[], candidate: Candidate) => {
                const imageParts = candidate.content?.parts?.filter((part: Part) => part.inlineData?.mimeType?.startsWith('image/'));
                if (imageParts) {
                    for (const part of imageParts) {
                        if (part.inlineData?.data) {
                            acc.push({
                                buffer: Buffer.from(part.inlineData.data, 'base64'),
                                mimeType: part.inlineData.mimeType,
                            });
                        }
                    }
                }
                return acc;
            }, []);


            // 4. 최종 응답 객체 생성
            const finalResponse: GenerationOutput = {};

            if (outputImages && outputImages.length > 0) {
                finalResponse.images = outputImages;
            }

            // result.text는 모든 텍스트 파트를 편리하게 결합해주므로 이를 활용
            if (result.text) {
                finalResponse.text = result.text;
            }

            // 전체 parts와 groundingMetadata도 필요한 경우를 위해 포함
            if (firstCandidate?.content?.parts) {
                finalResponse.parts = firstCandidate.content.parts;
            }
            if (firstCandidate?.groundingMetadata) {
                finalResponse.groundingMetadata = firstCandidate.groundingMetadata;
            }

            // 5. JS 버전과 동일하게, 유효한 콘텐츠가 있는지 확인
            if (Object.keys(finalResponse).length === 0) {
                 console.error("API 응답에 이미지 또는 텍스트 데이터가 없습니다.", JSON.stringify(result, null, 2));
                 return {error: 'API가 인식할 수 없는 응답을 반환했습니다.'};
            }

            return finalResponse;

        } catch (error: unknown) {
            let errorMessage = '알 수 없는 API 오류가 발생했습니다.';
            if (error instanceof Error) {
                errorMessage = error.message;
            }

            if (errorMessage.includes('"code":503') && attempt < MAX_RETRIES) {
                console.warn(`API 503 오류(모델 과부하) 발생. 5초 후 ${attempt + 1}번째 시도를 합니다.`);
                await delay(5000);
            } else if (errorMessage.includes('"code":500') && attempt < MAX_RETRIES) {
                console.warn(`API 500 오류(내부 서버) 발생. 1초 후 ${attempt + 1}번째 시도를 합니다.`);
                await delay(1000);
            } else {
                console.error(`API 연동 중 최종 오류 발생 (시도 ${attempt}/${MAX_RETRIES}):`, error);
                try {
                    // 오류 메시지에서 JSON 부분만 추출하여 파싱
                    const jsonErrorMatch = errorMessage.match(/({.*})/);
                    if (jsonErrorMatch) {
                        const parsedError = JSON.parse(jsonErrorMatch[0]);
                        const finalMessage = parsedError?.error?.message || 'API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
                        return {error: finalMessage};
                    }
                } catch (e) {
                    // 파싱 실패 시 일반 오류 메시지 반환
                }
                return {error: 'API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'};
            }
        }
    }
    // 모든 재시도 실패 시
    return { error: 'API 요청에 실패했습니다. (최대 재시도 횟수 초과)' };
}