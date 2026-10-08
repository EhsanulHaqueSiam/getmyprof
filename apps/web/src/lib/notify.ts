// Desktop notifications, only for what needs the user: a thread waiting on an Approval or an
// Input answer. Opt-in from Settings; the choice lives in this browser.
import type { ThreadSummary } from "@getmyprof/contracts";

const KEY = "getmyprof.notify";
/** Fired on window when a notification is clicked; the root route opens that thread. */
export const OPEN_THREAD = "getmyprof:open-thread";

const supported = () => typeof window !== "undefined" && "Notification" in window;
export const notifyOn = () =>
  supported() && localStorage.getItem(KEY) === "1" && Notification.permission === "granted";

export async function enableNotify() {
  if (!supported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "granted") localStorage.setItem(KEY, "1");
  return permission;
}
export const disableNotify = () => localStorage.removeItem(KEY);

/** Threads that just started waiting on the user, comparing two pushes of the thread list. */
export function newlyWaiting(before: ThreadSummary[], after: ThreadSummary[]) {
  const was = new Map(before.map((t) => [t.id, t.status]));
  return after.filter(
    (t) => (t.status === "approval" || t.status === "input") && was.get(t.id) !== t.status,
  );
}

/** Shows one notification per newly waiting thread, unless the user is already looking at it. */
export function notifyWaiting(before: ThreadSummary[], after: ThreadSummary[]) {
  if (!notifyOn()) return;
  for (const t of newlyWaiting(before, after)) {
    if (!document.hidden && location.pathname === `/t/${t.id}`) continue;
    const n = new Notification(t.status === "approval" ? "Approval needed" : "A question for you", {
      body: t.title,
      tag: t.id,
    });
    n.addEventListener("click", () => {
      window.focus();
      window.dispatchEvent(new CustomEvent(OPEN_THREAD, { detail: t.id }));
    });
  }
}
