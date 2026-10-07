import type {
  AppState,
  Conversation,
  Settings,
  ThreadEvent,
  VaultState,
  ThreadSummary,
  ThreadView,
} from "@gradcode/contracts";
import { create } from "zustand";
import { notifyWaiting } from "~/lib/notify";
import { call, onClose, onPush } from "~/rpc/client";

type Store = {
  live: boolean;
  app: AppState | null;
  threads: ThreadSummary[];
  views: Record<string, ThreadView>;
  /** Everyone in the pipeline. Reloaded whenever outreach changes. */
  conversations: Conversation[];
  /** Documents, opportunities and To file. Reloaded whenever the vault changes. */
  vault: VaultState | null;
  /** Bumped when records or loops change, so views that list them refetch. */
  recordsVersion: number;
  loopsVersion: number;
  sidebarOpen: boolean;
  paletteOpen: boolean;
  /** A refused action's reason, shown until dismissed. */
  notice: string | null;
  loadApp: () => Promise<void>;
  loadView: (threadId: string) => Promise<void>;
  loadOutreach: () => Promise<void>;
  loadVault: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  setPalette: (open: boolean) => void;
  setNotice: (notice: string | null) => void;
  toggleSidebar: () => void;
};

export const useStore = create<Store>()((set, get) => ({
  live: false,
  app: null,
  threads: [],
  views: {},
  conversations: [],
  vault: null,
  recordsVersion: 0,
  loopsVersion: 0,
  sidebarOpen: true,
  paletteOpen: false,
  notice: null,
  loadApp: async () => {
    const [app, threads] = await Promise.all([call("state.get", {}), call("threads.list", {})]);
    set({ app, threads });
  },
  loadView: async (threadId) => {
    const view = await call("threads.view", { id: threadId });
    set((s) => ({ views: { ...s.views, [threadId]: view } }));
  },
  loadOutreach: async () => set({ conversations: await call("outreach.list", {}) }),
  loadVault: async () => set({ vault: await call("vault.get", {}) }),
  saveSettings: async (patch) => {
    const settings = await call("settings.update", patch);
    const app = get().app;
    if (app) set({ app: { ...app, settings } });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setNotice: (notice) => set({ notice }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));

function upsertEvent(events: ThreadEvent[], event: ThreadEvent) {
  const i = events.findIndex((e) => e.id === event.id);
  if (i === -1) return [...events, event];
  const next = events.slice();
  next[i] = event;
  return next;
}

/** Wires server pushes into the store. Called once from main.tsx. */
export function subscribe() {
  const { getState, setState } = useStore;
  onClose(() => setState({ live: false }));
  onPush((m) => {
    if (m.type === "hello") {
      setState({ live: true });
      void getState().loadApp();
      void getState().loadOutreach();
      void getState().loadVault();
      for (const id of Object.keys(getState().views)) void getState().loadView(id);
    }
    if (m.type === "threads") {
      notifyWaiting(getState().threads, m.threads);
      setState((s) => ({
        threads: m.threads,
        views: Object.fromEntries(
          Object.entries(s.views).map(([id, v]) => [
            id,
            { ...v, thread: m.threads.find((t) => t.id === id) ?? v.thread },
          ]),
        ),
      }));
    }
    if (m.type === "event") {
      const view = getState().views[m.threadId];
      if (view)
        setState((s) => ({
          views: {
            ...s.views,
            [m.threadId]: { ...view, events: upsertEvent(view.events, m.event) },
          },
        }));
    }
    if (m.type === "changed") {
      if (
        (m.what === "proposals" || m.what === "thread") &&
        m.threadId &&
        getState().views[m.threadId]
      )
        void getState().loadView(m.threadId);
      if (m.what === "records") setState((s) => ({ recordsVersion: s.recordsVersion + 1 }));
      if (m.what === "loops") setState((s) => ({ loopsVersion: s.loopsVersion + 1 }));
      if (m.what === "state") void getState().loadApp();
      if (m.what === "outreach") void getState().loadOutreach();
      if (m.what === "vault") void getState().loadVault();
    }
  });
}
