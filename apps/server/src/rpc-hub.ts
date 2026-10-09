// The hub's methods, both sides: the owner's students and invites, and this install's own
// connection to a counselor's hub. rpc.ts spreads these into its handlers; bin.ts calls
// hub.syncNow hourly.
import { connectHub, disconnectHub, hubStatus, setMember, syncHub } from "./hub-member.ts";
import { inviteStudent, listStudents, removeStudent } from "./hub.ts";
import { tailnetLink } from "./health.ts";
import type { Handlers, Services } from "./rpc.ts";
import { listThreads } from "./threads.ts";

type HubMethod = Extract<keyof Handlers, `hub.${string}`>;

export function hubHandlers(svc: Services): Pick<Handlers, HubMethod> {
  const { db, bus } = svc;
  const changedState = () => bus.push({ type: "changed", what: "state" });
  const sync = async () => {
    const r = await syncHub(db);
    if (r?.filed) bus.push({ type: "changed", what: "vault" });
    if (r?.threadId) {
      bus.push({ type: "changed", what: "proposals", threadId: r.threadId });
      bus.push({ type: "threads", threads: listThreads(db) });
    }
    if (r) changedState();
    return hubStatus(db);
  };
  return {
    "hub.students": () => listStudents(db),
    // Students reach this hub at the address the owner gives, or the tailnet's when it's served.
    "hub.invite": ({ name, url }) => {
      const link = svc.fake ? null : tailnetLink();
      const invite = inviteStudent(db, name, url ?? (link?.served ? link.url : ""));
      changedState();
      return invite;
    },
    "hub.remove": ({ id }) => {
      removeStudent(db, id);
      changedState();
      return { ok: true };
    },
    "hub.connect": ({ code }) => {
      connectHub(db, code);
      return sync();
    },
    "hub.disconnect": () => {
      disconnectHub(db);
      return null;
    },
    "hub.status": () => hubStatus(db),
    "hub.setMember": (patch) => {
      setMember(db, patch);
      return hubStatus(db);
    },
    "hub.syncNow": () => sync(),
  };
}
