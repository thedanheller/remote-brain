import bs58 from "bs58";
import { MAX_PROMPT_SIZE } from "@localllm/protocol";
import { isSendDisabled, parseServerId } from "./inputValidation";

describe("inputValidation", () => {
  test("rejects server ID with invalid base58", () => {
    expect(parseServerId("not-valid-%%")).toBeNull();
  });

  test("rejects server ID that does not decode to 32 bytes", () => {
    const invalidLengthServerId = bs58.encode(Uint8Array.from({ length: 31 }, (_, i) => i + 1));
    expect(parseServerId(invalidLengthServerId)).toBeNull();
  });

  test("prompt exceeding MAX_PROMPT_SIZE disables send", () => {
    const prompt = "a".repeat(MAX_PROMPT_SIZE + 1);

    expect(
      isSendDisabled({
        connectionState: "connected",
        isGenerating: false,
        prompt,
      }),
    ).toBe(true);
  });

  test("prompt byte length uses UTF-8, not character count", () => {
    const prompt = "😀".repeat(Math.floor(MAX_PROMPT_SIZE / 4) + 1);

    expect(
      isSendDisabled({
        connectionState: "connected",
        isGenerating: false,
        prompt,
      }),
    ).toBe(true);
  });
});
