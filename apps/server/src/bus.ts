import type { ServerMessage } from "@getmyprof/contracts";

type Send = (message: ServerMessage) => void;

/** Fan-out to every connected client. bin.ts registers each socket; services just `push`. */
export function createBus() {
  const clients = new Set<Send>();
  return {
    add(send: Send) {
      clients.add(send);
      return () => clients.delete(send);
    },
    push(message: ServerMessage) {
      for (const send of clients) send(message);
    },
  };
}

export type Bus = ReturnType<typeof createBus>;
