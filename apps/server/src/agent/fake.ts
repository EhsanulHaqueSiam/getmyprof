// A scripted agent for e2e and offline dev (GRADCODE_AGENT=fake). It runs the real hunt tools
// against fixture sources, so proposals, approvals, spend and settling behave exactly as with
// Claude, for free and the same way every time.
import { type RowOp, type ThreadEvent } from "@gradcode/contracts";
import { now } from "../db.ts";
import type { AgentProvider, SessionStart } from "./provider.ts";
import { capProblem, type HuntTool, type Sources } from "./tools.ts";

const FIXTURE_PROFESSORS = [
  {
    name: "Kevin Lybarger",
    university: "George Mason University",
    niche: "clinical NLP",
    fit: 5,
    moneyTier: 2,
    taking: 'yes, "PhD 2027" in the subject',
    money: "NIH team grant $4.65M",
    lasts: "not posted",
    contact: 'email, subject "PhD 2027"',
    sources: ["https://www.kevinlybarger.me/news.html"],
  },
  {
    name: "Mohan Zalake",
    university: "University of Illinois Chicago",
    niche: "LLM agents in health",
    fit: 5,
    moneyTier: 2,
    taking: "yes, join-us page",
    money: "NIA-funded pilot",
    lasts: "not posted",
    contact: "follow the join-us page",
    sources: ["https://vare.ahs.uic.edu/"],
  },
  {
    name: "Natalie Parde",
    university: "University of Illinois Chicago",
    niche: "health NLP, multimodal",
    fit: 3,
    moneyTier: 2,
    taking: "apply, list me",
    money: "NSF ~$1.2M",
    lasts: "?",
    contact: "apply-only, no cold email",
    stage: "apply-only",
    sources: ["https://www.natalieparde.com/team.html"],
  },
];

export const fixtureSources: Sources = {
  nsf: async () => [
    {
      source: "NSF",
      id: "2439202",
      title:
        "CAREER: Leveraging Grammar Books to Develop Language Technologies for Data-Scarce Languages",
      pi: "Antonios Anastasopoulos",
      university: "George Mason University",
      usd: 599956,
      starts: "2025-06-15",
      ends: "2030-05-31",
      abstract: "Fixture award.",
    },
  ],
  nih: async () => [],
  openalex: async (name) => ({
    name,
    institution: "Fixture University",
    works: 42,
    citations: 900,
    topics: ["NLP"],
    recent: [],
  }),
  treg: async () => ({ result: "deliverable" }),
};

const FIELD_FOR: Record<RowOp, string> = {
  email: "emailCheck",
  lasts: "lasts",
  taking: "taking",
  draft: "stage",
};
const VALUE_FOR: Record<RowOp, string> = {
  email: "ok",
  lasts: "checked: no award as PI",
  taking: "not stated",
  draft: "drafted",
};

/** Row actions reach the agent as a tagged prompt; see runner.rowActionPrompt. */
const ROW_TAG = /^\[row-action:(email|lasts|taking|draft)\] keys=(\S+)/;

export const fakeProvider = (
  delayMs = Number(process.env.GRADCODE_FAKE_DELAY ?? 120),
): AgentProvider => ({
  start(s: SessionStart) {
    const { hooks } = s;
    const pause = () => new Promise((r) => setTimeout(r, delayMs));
    const queue: string[] = [];
    let busy = false;
    let stopped = false;
    let n = 0;

    const tool = (name: string) => s.tools.find((t) => t.name === name) as HuntTool | undefined;
    const call = async (name: string, detail: string, args: Record<string, unknown>) => {
      const t = tool(name);
      const id = `fake-${++n}-${Date.now()}`;
      const base = { id, type: "tool" as const, name, detail, costUsd: 0 };
      hooks.emit({ ...base, at: now(), status: "running", meta: "" });
      await pause();
      if (!t) return hooks.emit({ ...base, at: now(), status: "error", meta: "not available" });
      const r = await t.run(args, s.toolContext);
      hooks.emit({
        ...base,
        at: now(),
        status: "done",
        meta: r.summary,
        costUsd: t.paid ? t.price(args) : 0,
      });
    };
    const say = (text: string) =>
      hooks.emit({
        id: `fake-say-${++n}`,
        at: now(),
        type: "assistant",
        text,
      } satisfies ThreadEvent);

    async function hunt() {
      await call("sheet_search", "health NLP", { query: "NLP" });
      await call("nsf_awards", "language model · George Mason", {
        terms: ["language model"],
        university: "George Mason University",
      });
      for (const p of FIXTURE_PROFESSORS) {
        if (stopped) return;
        await call("propose_professor", `${p.name} · ${p.university}`, p);
      }
      const treg = tool("treg");
      if (treg && !stopped) {
        const args = {
          endpoint: "prospeo.people.email.find",
          data: { full_name: "Mohan Zalake" },
          purpose: "Zalake's listed address isn't on an official page",
        };
        const price = treg.price(args);
        const cap = capProblem(s.toolContext, price);
        const ok =
          !cap &&
          (price <= s.askOver ||
            (await hooks.requestApproval({
              title: "paid lookup",
              body: `${args.endpoint} · $${price}`,
              why: args.purpose,
              costUsd: price,
            })));
        if (ok) await call("treg", args.purpose, args);
        else
          hooks.emit({
            id: `fake-deny-${++n}`,
            at: now(),
            type: "tool",
            name: `treg ${args.endpoint}`,
            detail: args.purpose,
            status: "denied",
            meta: cap ?? "declined",
            costUsd: 0,
          });
      }
      say(
        "Three came up. Lybarger and Zalake can likely take a student for your intake; Parde wants applications, not cold email. Three changes are waiting in Review.",
      );
    }

    async function rowAction(op: RowOp, keys: string[]) {
      const rows = keys
        .map((k) =>
          FIXTURE_PROFESSORS.find((p) => k.startsWith(p.name.toLowerCase().replaceAll(" ", "-"))),
        )
        .filter((p) => p !== undefined);
      let skipped = 0;
      for (const p of rows) {
        if (op === "draft" && p.contact.startsWith("apply-only")) {
          skipped++;
          continue;
        }
        await call("propose_professor", `${p.name} · ${p.university}`, {
          name: p.name,
          university: p.university,
          [FIELD_FOR[op]]: VALUE_FOR[op],
          sources: p.sources,
        });
      }
      say(
        `Done for ${rows.length - skipped} row${rows.length - skipped === 1 ? "" : "s"}.${skipped ? ` Skipped ${skipped} apply-only.` : ""}`,
      );
    }

    async function run(text: string) {
      busy = true;
      stopped = false;
      const started = Date.now();
      hooks.turnStarted();
      const row = ROW_TAG.exec(text);
      if (row?.[1] && row[2]) await rowAction(row[1] as RowOp, row[2].split(","));
      else if (n === 0) await hunt();
      else {
        await pause();
        say(`Noted: ${text.slice(0, 120)}`);
      }
      hooks.turnEnded({ durationMs: Date.now() - started, error: stopped ? "interrupted" : null });
      busy = false;
      const next = queue.shift();
      if (next !== undefined) void run(next);
    }

    hooks.sessionId(`fake-session-${s.threadId}`);
    void run(s.firstText);
    return {
      push(text) {
        if (busy) queue.push(text);
        else void run(text);
      },
      interrupt: async () => {
        stopped = true;
      },
      close: () => hooks.closed(),
    };
  },
});
