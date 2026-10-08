import {
  type Method,
  type MethodInput,
  type MethodOutput,
  Methods,
  ServerMessage,
} from "@getmyprof/contracts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: Method;
};

const pending = new Map<number, Pending>();
const listeners = new Set<(m: ServerMessage) => void>();
const closeListeners = new Set<() => void>();
let socket: WebSocket | null = null;
let nextId = 1;
const outbox: string[] = [];

/**
 * Opens /ws for the app's lifetime and reconnects a second after a drop. Requests sent while
 * the socket is down wait in an outbox. Called once from main.tsx, outside React.
 */
export function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const open = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      for (const m of outbox.splice(0)) ws.send(m);
    });
    ws.addEventListener("message", (event) => {
      const parsed = ServerMessage.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === "reply") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (!p) return;
        if (m.ok) p.resolve(Methods[p.method].output.parse(m.result));
        else p.reject(new Error(m.error ?? "request failed"));
        return;
      }
      for (const l of listeners) l(m);
    });
    ws.addEventListener("close", () => {
      socket = null;
      for (const l of closeListeners) l();
      setTimeout(open, 1000);
    });
  };
  open();
}

/** Calls a server method; input and output types come from the contracts. */
export function call<M extends Method>(method: M, input: MethodInput<M>): Promise<MethodOutput<M>> {
  const id = nextId++;
  const body = JSON.stringify({ id, method, params: input });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as MethodOutput<M>), reject, method });
    if (socket?.readyState === WebSocket.OPEN) socket.send(body);
    else outbox.push(body);
  });
}

/** Subscribes to server pushes (hello, threads, events, changes). Returns the unsubscribe. */
export function onPush(listener: (m: ServerMessage) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes to socket drops (the reconnect is automatic; `hello` marks it back up). */
export function onClose(listener: () => void) {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

export const isOpen = () => socket?.readyState === WebSocket.OPEN;
