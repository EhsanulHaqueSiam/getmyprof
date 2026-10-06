import { Health, ServerMessage } from "@gradcode/contracts";
import { create } from "zustand";

type ConnectionState = {
  status: "connecting" | "live" | "down";
  health: Health | null;
  /** Re-reads GET /api/health, e.g. after installing a missing tool. */
  checkHealth: () => Promise<void>;
};

export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: "connecting",
  health: null,
  checkHealth: async () => {
    const res = await fetch("/api/health").catch(() => null);
    set({ health: res?.ok ? Health.parse(await res.json()) : null });
  },
}));

/**
 * Opens /ws once for the app's lifetime and reconnects a second after any drop. Called
 * from main.tsx, outside React, so StrictMode never opens a second socket.
 */
export function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const open = () => {
    const ws = new WebSocket(url);
    ws.addEventListener("message", (event) => {
      const message = ServerMessage.safeParse(JSON.parse(String(event.data)));
      if (message.success && message.data.type === "hello") {
        useConnectionStore.setState({ status: "live" });
        void useConnectionStore.getState().checkHealth();
      }
    });
    ws.addEventListener("close", () => {
      useConnectionStore.setState({ status: "down" });
      setTimeout(open, 1000);
    });
  };
  open();
}
