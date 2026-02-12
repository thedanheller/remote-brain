export function encode(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export type DecoderCallback = (parsed: unknown) => void;

export interface Decoder {
  write(chunk: string): void;
}

export function createDecoder(onMessage: DecoderCallback): Decoder {
  let buffer = "";

  return {
    write(chunk: string) {
      buffer += chunk;

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length === 0) continue;

        try {
          const parsed = JSON.parse(line);
          onMessage(parsed);
        } catch {
          // Skip invalid JSON lines
        }
      }
    },
  };
}
