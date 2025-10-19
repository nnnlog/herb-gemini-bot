/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transformIgnorePatterns: [
        '/node_modules/(?!marked)/',
    ],
    testMatch: [
        '**/tests/**/*.test.ts',
    ],
    clearMocks: true,
};
