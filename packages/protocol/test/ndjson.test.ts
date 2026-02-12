import { describe, it, expect } from "vitest";
import { encode, createDecoder } from "../src/ndjson.js";

describe("encode", () => {
  it("encodes an object as JSON + newline", () => {
    const result = encode({ type: "server_info" });
    expect(result).toBe('{"type":"server_info"}\n');
  });
});

describe("createDecoder", () => {
  it("decodes a single complete message", () => {
    const messages: unknown[] = [];
    const decoder = createDecoder((msg) => messages.push(msg));

    decoder.write('{"type":"server_info"}\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "server_info" });
  });

  it("decodes multiple messages in one chunk", () => {
    const messages: unknown[] = [];
    const decoder = createDecoder((msg) => messages.push(msg));

    decoder.write('{"a":1}\n{"b":2}\n{"c":3}\n');

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ a: 1 });
    expect(messages[1]).toEqual({ b: 2 });
    expect(messages[2]).toEqual({ c: 3 });
  });

  it("decodes a message split across chunks", () => {
    const messages: unknown[] = [];
    const decoder = createDecoder((msg) => messages.push(msg));

    decoder.write('{"type":');
    expect(messages).toHaveLength(0);

    decoder.write('"chat_start"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "chat_start" });
  });

  it("handles invalid JSON gracefully", () => {
    const messages: unknown[] = [];
    const decoder = createDecoder((msg) => messages.push(msg));

    decoder.write("not json\n");
    expect(messages).toHaveLength(0);

    // Valid message after invalid one still works
    decoder.write('{"ok":true}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ ok: true });
  });

  it("skips empty lines", () => {
    const messages: unknown[] = [];
    const decoder = createDecoder((msg) => messages.push(msg));

    decoder.write('\n\n{"a":1}\n\n');
    expect(messages).toHaveLength(1);
  });
});
