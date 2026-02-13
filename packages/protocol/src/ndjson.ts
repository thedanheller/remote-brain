export function encode(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export type DecoderCallback = (parsed: unknown) => void;
export type DecoderErrorCallback = (error: string) => void;

export interface Decoder {
  write(chunk: string): void;
}

// Maximum buffer size: 64 KB
const MAX_BUFFER_SIZE = 64 * 1024;

export function createDecoder(
  onMessage: DecoderCallback,
  onError?: DecoderErrorCallback,
): Decoder {
  let buffer = "";

  return {
    write(chunk: string) {
      buffer += chunk;

      // Check buffer limit
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = "";
        if (onError) {
          onError("Buffer exceeded 64 KB without finding newline");
        }
        return;
      }

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
