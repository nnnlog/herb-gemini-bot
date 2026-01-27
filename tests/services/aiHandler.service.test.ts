import {beforeEach, describe, expect, it, jest} from '@jest/globals';

// --- Mock Setup ---

// 1. Define the mock functions that will be used by the mock implementation
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
    generateContent: mockGenerateContent,
}));

// 2. Mock the entire @google/genai module, accounting for the default export
jest.unstable_mockModule('@google/genai', () => ({
    GoogleGenAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: mockGetGenerativeModel,
        models: {generateContent: mockGenerateContent}, // Match original structure
    })),
}));

jest.useFakeTimers();

describe('AI Handler Service - generateFromHistory', () => {
    let generateFromHistory: typeof import('../../src/services/aiHandler.js').generateFromHistory;

    beforeEach(async () => {
        // Dynamically import the module under test after mocks are set up
        const aiHandler = await import('../../src/services/aiHandler.js');
        generateFromHistory = aiHandler.generateFromHistory;

        // Clear mocks before each test
        jest.clearAllMocks();
        mockGenerateContent.mockClear();
        mockGetGenerativeModel.mockClear();
    });

    it('시나리오 3.1: API가 503 오류를 반환하면, 재시도 로직이 동작해야 합니다.', async () => {
        const error503 = new Error('some error with "code":503 in it');
        mockGenerateContent
            .mockRejectedValueOnce(error503)
            .mockRejectedValueOnce(error503)
            .mockResolvedValueOnce({
                text: 'Success on third try',
                candidates: [{content: {parts: [{text: 'Success on third try'}]}}],
                promptFeedback: undefined
            });

        const request = {model: 'gemini-pro', contents: []};
        const promise = generateFromHistory(request, 'fake-api-key');

        await jest.runAllTimersAsync();
        const result = await promise;

        expect(mockGenerateContent).toHaveBeenCalledTimes(3);
        expect(result.text).toBe('Success on third try');
    });

    it('시나리오 3.1.1: API가 500 오류를 반환하면, 재시도 로직이 동작해야 합니다.', async () => {
        const error500 = new Error('Internal server error with "code":500');
        mockGenerateContent
            .mockRejectedValueOnce(error500) // First call fails
            .mockResolvedValueOnce({          // Second call succeeds
                text: 'Success on second try',
                candidates: [{content: {parts: [{text: 'Success on second try'}]}}],
                promptFeedback: undefined
            });

        const request = {model: 'gemini-pro', contents: []};
        const promise = generateFromHistory(request, 'fake-api-key');

        await jest.runAllTimersAsync();
        const result = await promise;

        expect(mockGenerateContent).toHaveBeenCalledTimes(2);
        expect(result.text).toBe('Success on second try');
    });

    it('시나리오 3.2: 모든 재시도가 실패하면, 최종 오류 메시지를 반환해야 합니다.', async () => {
        const finalError = new Error('Final failure');
        mockGenerateContent.mockRejectedValue(finalError);

        const request = {model: 'gemini-pro', contents: []};
        const promise = generateFromHistory(request, 'fake-api-key');

        await jest.runAllTimersAsync();
        const result = await promise;

        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        expect(result.error).toContain('API 오류가 발생했습니다');
    });

    it('시나리오 3.3: API가 안전 필터에 의해 차단된 응답을 보내면, 이를 감지하고 오류를 반환해야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: '',
            candidates: [{finishReason: 'SAFETY', content: {parts: []}}],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('모델이 생성한 내용이 안전 정책에 따라 차단되었습니다');
    });

    it('시나리오 3.3.1: API가 프롬프트 자체를 차단하면, 이를 감지하고 오류를 반환해야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: '',
            candidates: [],
            promptFeedback: {blockReason: 'SAFETY'}
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('요청하신 내용은 안전 정책에 따라 처리할 수 없습니다');
    });

    it('시나리오 3.4: API가 텍스트나 이미지가 없는 비정상적 응답을 보내면, 오류를 반환해야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: '',
            candidates: [{content: null}],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('API가 인식할 수 없는 응답을 반환했습니다');
    });

    it('시나리오 3.5: API가 텍스트와 이미지를 모두 포함한 복합 콘텐츠를 보내면, 올바르게 파싱해야 합니다.', async () => {
        const mockResponse = {
            text: 'This is a cat',
            candidates: [{
                content: {
                    parts: [
                        {text: 'This is a cat'},
                        {
                            inlineData: {
                                mimeType: 'image/png',
                                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
                            }
                        }
                    ]
                }
            }],
            promptFeedback: undefined
        };
        mockGenerateContent.mockResolvedValue(mockResponse);
        const request = {model: 'gemini-pro-vision', contents: []};

        const result = await generateFromHistory(request, 'fake-api-key');

        expect(result.error).toBeUndefined();
        expect(result.text).toBe('This is a cat');
        expect(result.images).toHaveLength(1);
        expect(result.images?.[0].buffer).toBeInstanceOf(Buffer);
    });

    it('시나리오 3.6: API 오류 메시지가 JSON 형식이 아닐 때, 일반 오류를 반환해야 합니다.', async () => {
        const nonJsonError = new Error('A non-JSON error message');
        mockGenerateContent.mockRejectedValue(nonJsonError);
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('API 오류가 발생했습니다');
    });

    it('시나리오 3.7: API가 MALFORMED_FUNCTION_CALL로 응답하면, 명확한 오류 메시지를 반환해야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: '',
            candidates: [{
                finishReason: 'MALFORMED_FUNCTION_CALL',
                content: {}
            }],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('AI 모델이 요청을 처리하는 중 오류가 발생했습니다');
    });

    it('시나리오 3.8: API가 비정상적인 finishReason을 반환하면, 해당 이유를 포함한 오류를 반환해야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: '',
            candidates: [{
                finishReason: 'RECITATION',
                content: {}
            }],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toContain('요청 처리 중 오류가 발생했습니다');
        expect(result.error).toContain('RECITATION');
    });

    it('시나리오 3.9: 정상적인 finishReason (STOP)인 경우, 정상적으로 처리되어야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: 'Normal response',
            candidates: [{
                finishReason: 'STOP',
                content: {parts: [{text: 'Normal response'}]}
            }],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toBeUndefined();
        expect(result.text).toBe('Normal response');
    });

    it('시나리오 3.10: 정상적인 finishReason (MAX_TOKENS)인 경우, 정상적으로 처리되어야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: 'Response cut off due to max tokens',
            candidates: [{
                finishReason: 'MAX_TOKENS',
                content: {parts: [{text: 'Response cut off due to max tokens'}]}
            }],
            promptFeedback: undefined
        });
        const request = {model: 'gemini-pro', contents: []};
        const result = await generateFromHistory(request, 'fake-api-key');
        expect(result.error).toBeUndefined();
        expect(result.text).toBe('Response cut off due to max tokens');
    });

    it('시나리오 3.11: request.config.httpOptions.timeout 설정 시, abortSignal이 자동으로 추가되어야 합니다.', async () => {
        mockGenerateContent.mockResolvedValue({
            text: 'Timeout test',
            candidates: [{content: {parts: [{text: 'Timeout test'}]}}],
            promptFeedback: undefined
        });

        const request = {
            model: 'gemini-pro',
            contents: [],
            config: {
                httpOptions: {
                    timeout: 5000 // 5 seconds
                }
            }
        };

        await generateFromHistory(request, 'fake-api-key');

        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        const calledRequest = mockGenerateContent.mock.calls[0][0];
        // Expect abortSignal to be present in config
        expect(calledRequest.config.abortSignal).toBeDefined();
        expect(calledRequest.config.abortSignal).toBeInstanceOf(AbortSignal);
    });
});
