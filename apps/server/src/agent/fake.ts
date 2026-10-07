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
    email: "lybarger@example.edu",
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
    email: "zalake@example.edu",
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

const FIXTURE_SCHOLARSHIPS = [
  {
    name: "Fulbright Foreign Student Program",
    sponsor: "US Department of State",
    studyIn: "USA",
    citizenship: ["Bangladesh"],
    tracks: ["phd", "ms_phd", "funded_ms"],
    amount: "tuition, stipend, travel",
    deadline: "2027-02-15",
    url: "https://bd.usembassy.gov/education-culture/fulbright/",
    sources: ["https://bd.usembassy.gov/education-culture/fulbright/"],
    why: "open to Bangladeshi citizens for a US master's or PhD",
  },
  {
    name: "Chevening Scholarship",
    sponsor: "UK Foreign Office",
    studyIn: "UK",
    citizenship: [],
    tracks: ["funded_ms"],
    amount: "tuition, stipend, flights",
    deadline: "2026-11-04",
    url: "https://www.chevening.org/",
    sources: ["https://www.chevening.org/"],
    why: "one-year UK master's; only fits a funded-master's track",
  },
];

const FIXTURE_PROGRAMS = [
  {
    university: "George Mason University",
    name: "PhD in Information Technology",
    degree: "phd",
    deadline: "2026-12-01",
    fee: "$75",
    waiver: "on request for international applicants",
    english: "IELTS 6.5; MOI considered",
    funding: "GRA/GTA for most admits",
    url: "https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology",
    sources: ["https://cec.gmu.edu/academics/doctoral-programs/phd-information-technology"],
    why: "Lybarger and Yao advise through it",
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

/** Row actions, replies and follow-ups reach the agent as tagged prompts (runner, outreach/service). */
const ROW_TAG = /^\[row-action:(email|lasts|taking|draft)\] keys=(\S+)/;
const REPLY = /^\[reply:(\S+)\] (.+?) \((.+?)\) wrote back/;
const AFTER_LINE = /^- (.+?) \| (.+?) \| key \S+ \| to (\S+) \| zone (\S+)/gm;
const FOLLOW_UP_LINE =
  /^- (.+?) \| (.+?) \| key \S+ \| (follow-up-[12]) \| to (\S+) \| zone (\S+)/gm;
const ZONE: Record<string, string> = {
  "George Mason University": "America/New_York",
  "University of Illinois Chicago": "America/Chicago",
};

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

    const firstEmail = (p: (typeof FIXTURE_PROFESSORS)[number]) => ({
      name: p.name,
      university: p.university,
      channel: "email",
      touch: "first",
      to: p.email ?? "",
      subject: p.contact.includes("PhD 2027") ? "PhD 2027" : "Prospective PhD student, Fall 2027",
      body: `Dear Dr. ${p.name.split(" ").at(-1)},\n\nI'm applying for a funded PhD starting Fall 2027 and your work on ${p.niche} is close to what I want to do. Are you taking students for that intake?\n\nBest regards`,
      timeZone: ZONE[p.university] ?? "America/New_York",
    });

    async function answerReply(id: string, name: string, university: string) {
      await call("classify_reply", "interested", {
        messageId: id,
        replyClass: "interested",
        note: "asks for CV and a research note",
      });
      const p = FIXTURE_PROFESSORS.find((x) => x.name === name);
      await call("draft_email", `reply · ${name}`, {
        name,
        university,
        channel: "email",
        touch: "reply",
        to: p?.email ?? "",
        subject: "",
        body: `Dear Dr. ${name.split(" ").at(-1)},\n\nThank you. I'll send my CV and a short note on what I'd like to work on.\n\nBest regards`,
        timeZone: ZONE[university] ?? "America/New_York",
      });
      say(`${name} is interested and asks for a CV. An answer is drafted in Pipeline.`);
    }

    async function followUps(text: string) {
      let drafted = 0;
      for (const m of text.matchAll(FOLLOW_UP_LINE)) {
        const [, name = "", university = "", touch = "", to = "", timeZone = ""] = m;
        await call("draft_email", `${touch} · ${name}`, {
          name,
          university,
          channel: "email",
          touch,
          to,
          subject: "",
          body: `Dear Dr. ${name.split(" ").at(-1)},\n\nA short follow-up on my note about a funded PhD for Fall 2027. Your recent paper made me even more keen.\n\nBest regards`,
          timeZone,
        });
        drafted++;
      }
      say(`Drafted ${drafted} follow-up${drafted === 1 ? "" : "s"}.`);
    }

    async function vaultFinds(text: string) {
      const scholarships = /^Find scholarships/i.test(text);
      const finds = scholarships ? FIXTURE_SCHOLARSHIPS : FIXTURE_PROGRAMS;
      for (const f of finds)
        await call(scholarships ? "propose_scholarship" : "propose_program", f.name, f);
      say(`${finds.length} wait in your To file.`);
    }

    async function afterApplying(text: string) {
      let drafted = 0;
      for (const m of text.matchAll(AFTER_LINE)) {
        const [, name = "", university = "", to = "", timeZone = ""] = m;
        await call("draft_email", `after-applying · ${name}`, {
          name,
          university,
          channel: "email",
          touch: "after-applying",
          to,
          subject: "Applied for Fall 2027",
          body: `Dear Dr. ${name.split(" ").at(-1)},\n\nI've submitted my application for Fall 2027 and named you as a faculty member I'd like to work with.\n\nBest regards`,
          timeZone,
        });
        drafted++;
      }
      say(`Drafted ${drafted} note${drafted === 1 ? "" : "s"} for after applying.`);
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
        if (op === "draft") {
          await call("draft_email", `first · ${p.name}`, firstEmail(p));
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
      const reply = REPLY.exec(text);
      if (row?.[1] && row[2]) await rowAction(row[1] as RowOp, row[2].split(","));
      else if (reply?.[1] && reply[2] && reply[3]) await answerReply(reply[1], reply[2], reply[3]);
      else if (text.startsWith("[follow-up]")) await followUps(text);
      else if (text.startsWith("[after-applying]")) await afterApplying(text);
      else if (/^Find (scholarships|programs)/i.test(text)) await vaultFinds(text);
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
