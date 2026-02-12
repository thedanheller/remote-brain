/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  preset: "jest-expo",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^@localllm/protocol$": "<rootDir>/../../packages/protocol/dist/index.js",
  },
  testMatch: ["**/*.test.ts"],
};
