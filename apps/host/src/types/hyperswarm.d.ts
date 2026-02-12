declare module "hyperswarm" {
  import { EventEmitter } from "events";
  import type { Duplex } from "stream";

  interface Discovery {
    flushed(): Promise<void>;
    destroy(): void;
  }

  interface JoinOptions {
    server?: boolean;
    client?: boolean;
  }

  class Hyperswarm extends EventEmitter {
    constructor(options?: any);
    join(topic: Buffer, options?: JoinOptions): Discovery;
    leave(topic: Buffer): void;
    destroy(): Promise<void>;
    on(event: "connection", listener: (socket: Duplex, info: any) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export default Hyperswarm;
}
