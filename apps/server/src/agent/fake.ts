// A scripted agent for e2e and offline dev (GETMYPROF_AGENT=fake). It runs the real hunt tools
// against fixture sources, so proposals, approvals, spend and settling behave exactly as with
// Claude, for free and the same way every time.
import { addressChecked, type RowOp, type ThreadEvent } from "@getmyprof/contracts";
import { now } from "../db.ts";
import { getRecord, pendingCount } from "../records.ts";
import { listDocuments, listPrograms } from "../vault.ts";
import {
  FIXTURE_DECISIONS,
  FIXTURE_PROFESSORS,
  FIXTURE_PROGRAMS,
  FIXTURE_SCHOLARSHIPS,
  FIXTURE_SCHOOL_MONEY,
  FIXTURE_SCHOOLS,
  FIXTURE_WORK,
} from "./fixtures.ts";
import type { AgentProvider, SessionStart } from "./provider.ts";
import { askBlocked, capProblem, type HuntTool } from "./tools.ts";

// Recent work and focus fills several fields, from FIXTURE_WORK.
const FIELD_FOR: Record<Exclude<RowOp, "work">, string> = {
  email: "emailCheck",
  lasts: "lasts",
  taking: "taking",
  draft: "stage",
};
const VALUE_FOR: Record<Exclude<RowOp, "work">, string> = {
  email: "ok",
  lasts: "checked: no award as PI",
  taking: "not stated",
  draft: "drafted",
};

/** Row actions, replies and follow-ups reach the agent as tagged prompts (runner, outreach/service). */
const ROW_TAG = /^\[row-action:(email|lasts|taking|work|draft)\] keys=(\S+)/;
const REPLY = /^\[reply:(\S+)\] (.+?) \((.+?)\) wrote back/;
const WRITE = /^\[write\] kind=(\w+) program=(\S+) scholarship=(\S+) revise=(\S+)/;
const FACT_LINE = /^- \[\[(\S+?)\]\] (.+) \((confirmed|unconfirmed|needs proof|question)\)$/gm;
const orNull = (v: string | undefined) => (!v || v === "-" ? null : v);
const AFTER_LINE = /^- (.+?) \| (.+?) \| key \S+ \| to (\S+) \| zone (\S+)/gm;
const FOLLOW_UP_LINE =
  /^- (.+?) \| (.+?) \| key \S+ \| (follow-up-[12]) \| to (\S+) \| zone (\S+)/gm;
const ZONE: Record<string, string> = {
  "George Mason University": "America/New_York",
  "University of Illinois Chicago": "America/Chicago",
};

export const fakeProvider = (
  delayMs = Number(process.env.GETMYPROF_FAKE_DELAY ?? 120),
): AgentProvider => ({
  start(s: SessionStart) {
    const { hooks } = s;
    const pause = () => new Promise((r) => setTimeout(r, delayMs));
    const queue: string[] = [];
    let busy = false;
    let stopped = false;
    let n = 0;

    const tool = (name: string) => s.tools.find((t) => t.name === name) as HuntTool | undefined;
    let result = "";
    /** Runs a hunt tool like the model would; `result` holds its summary afterwards. */
    const call = async (name: string, detail: string, args: Record<string, unknown>) => {
      const t = tool(name);
      const id = `fake-${++n}-${Date.now()}`;
      const base = { id, type: "tool" as const, name, detail, costUsd: 0 };
      hooks.emit({ ...base, at: now(), status: "running", meta: "" });
      await pause();
      if (!t) return hooks.emit({ ...base, at: now(), status: "error", meta: "not available" });
      // An Ask turn reads only, like the real provider's gate.
      if (askBlocked(s.toolContext, name))
        return hooks.emit({ ...base, at: now(), status: "denied", meta: "ask mode" });
      const r = await t.run(args, s.toolContext);
      result = r.summary;
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
      // An Ask never buys anything, so it never asks to.
      if (treg && !stopped && !askBlocked(s.toolContext, "treg")) {
        const args = {
          endpoint: "prospeo.people.email.find",
          data: { full_name: "Mohan Zalake" },
          purpose: "Zalake's listed address isn't on an official page",
        };
        const price = treg.price(args);
        const cap = capProblem(s.toolContext, price);
        if (cap) s.toolContext.capHit(cap);
        const ok =
          !cap &&
          (price <= s.askOver() ||
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
      const waiting = pendingCount(s.toolContext.db, s.toolContext.threadId);
      say(
        `Three came up. Lybarger and Zalake can likely take a student for your intake; Parde wants applications, not cold email. ${waiting ? `${waiting} change${waiting === 1 ? " is" : "s are"} waiting in Review.` : "Nothing waits in Review."}`,
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
      // They asked for a CV: attach the one in the vault, if there is one.
      const cv = listDocuments(s.toolContext.db).find((d) => d.kind === "cv");
      await call("draft_email", `reply · ${name}`, {
        name,
        university,
        channel: "email",
        touch: "reply",
        to: p?.email ?? "",
        subject: "",
        body: `Dear Dr. ${name.split(" ").at(-1)},\n\nThank you. ${cv ? "My CV is attached, with" : "I'll send my CV and"} a short note on what I'd like to work on.\n\nBest regards`,
        timeZone: ZONE[university] ?? "America/New_York",
        ...(cv ? { attach: [cv.id] } : {}),
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
      let filed = 0;
      for (const f of finds) {
        await call(scholarships ? "propose_scholarship" : "propose_program", f.name, f);
        if (result === "to file") filed++;
      }
      // Checking programs at shortlisted schools also records George Mason's stipend and rent.
      if (/^Find programs at/i.test(text))
        await call("set_school_money", FIXTURE_SCHOOL_MONEY.name, FIXTURE_SCHOOL_MONEY);
      say(
        filed
          ? `${filed} ${filed === 1 ? "waits" : "wait"} in your To file.`
          : "Nothing new: everything I found is already in your vault.",
      );
    }

    /** Fills the shortlist from fixtures; schools already listed or dropped are refused. */
    async function suggestSchools() {
      let added = 0;
      for (const school of FIXTURE_SCHOOLS) {
        await call("propose_school", `${school.name} · ${school.tier}`, school);
        if (result.startsWith("suggested")) added++;
      }
      say(
        added
          ? `${added} school${added === 1 ? "" : "s"} wait on the Schools page.`
          : "Nothing new: every school I found is already on your list.",
      );
    }

    /** Notes last cycle's decision timing on every Vault program, from one fixture line. */
    async function decisionTiming() {
      const programs = listPrograms(s.toolContext.db);
      for (const p of programs)
        await call("note_program", p.name, { programId: p.id, ...FIXTURE_DECISIONS });
      say(
        `Noted decision timing on ${programs.length} program${programs.length === 1 ? "" : "s"}.`,
      );
    }

    /** Writes from the brief's facts: two confirmed ones, and one unproven one if there is any. */
    async function write(text: string) {
      const [, kind = "sop", program, scholarship, revise] = WRITE.exec(text) ?? [];
      const facts = [...text.matchAll(FACT_LINE)].map(([, id = "", fact = "", status = ""]) => ({
        id,
        fact,
        status,
      }));
      const proven = facts.filter((f) => f.status === "confirmed");
      const unproven = facts.find((f) => f.status === "unconfirmed" || f.status === "needs proof");
      const cite = (f: { id: string; fact: string } | undefined, lead: string) =>
        f ? `${lead} ${f.fact} [[${f.id}]].` : "";
      const body =
        kind === "prep"
          ? [
              "Their recent work: two papers worth reading before the call.",
              "Likely questions: why this lab, what you would work on first, how you handle a stalled experiment.",
              cite(proven[0], "Talking point:"),
            ]
              .filter(Boolean)
              .join("\n\n")
          : kind === "visa"
            ? "1. Get the admission letter and funding letter. 2. Apply for the student visa with them. 3. Book the interview early: waits run weeks."
            : kind === "note"
              ? "Thank you so much for writing my letter. It means a great deal, and I'll let you know how it goes."
              : kind === "letter"
                ? "Thank you for the offer. I am very keen to join. Would the program consider summer funding or a later answer date, so I can decide with care?"
                : kind === "cv"
                  ? [cite(proven[0], "Education:"), cite(unproven, "Grades:")]
                      .filter(Boolean)
                      .join("\n\n")
                  : [
                      `I want to build language technology that holds up for the people who rely on it. ${cite(proven[0], "My preparation:")}`,
                      [cite(proven[1], "Alongside it:"), cite(unproven, "I would also bring this:")]
                        .filter(Boolean)
                        .join(" "),
                      "I would like to continue this work with your faculty, on problems where careful evaluation matters.",
                    ]
                      .filter(Boolean)
                      .join("\n\n");
      await call("write_document", "draft", {
        pieceId: orNull(revise),
        kind,
        title: /title "(.+?)"/.exec(text)?.[1] ?? "Statement of purpose",
        programId: orNull(program),
        scholarshipId: orNull(scholarship),
        text: body,
      });
      say(
        `Saved in the Writer.${unproven && body.includes(unproven.id) ? " One claim cites a fact without proof, so export waits until it has some." : ""}`,
      );
    }

    async function thankYou(text: string) {
      for (const m of text.matchAll(AFTER_LINE)) {
        const [, name = "", university = "", to = "", timeZone = ""] = m;
        await call("draft_email", `thank-you · ${name}`, {
          name,
          university,
          channel: "email",
          touch: "thank-you",
          to,
          subject: "Thank you",
          body: `Dear Dr. ${name.split(" ").at(-1)},\n\nThank you for your time today. I enjoyed our conversation and remain very interested in joining your group.\n\nBest regards`,
          timeZone,
        });
      }
      say("A thank-you waits in Pipeline.");
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
      const rows = keys.flatMap((key) => {
        const p = FIXTURE_PROFESSORS.find((x) =>
          key.startsWith(x.name.toLowerCase().replaceAll(" ", "-")),
        );
        return p ? [{ ...p, key }] : [];
      });
      let skipped = 0;
      for (const p of rows) {
        // With paid lookups on, an address no official page lists is found through treg,
        // tagged with its row so the cell shows what it cost.
        if (op === "email" && tool("treg"))
          await call("treg", `email find · ${p.name}`, {
            endpoint: "treg.people.email.find",
            data: { full_name: p.name, company: p.university },
            purpose: "No official page lists the address",
            about: p.key,
          });
        if (op === "draft" && p.contact.startsWith("apply-only")) {
          skipped++;
          continue;
        }
        if (op === "draft") {
          // No checked address but a LinkedIn profile: a short note instead, like the real agent.
          const record = getRecord(s.toolContext.db, p.key);
          const note =
            record && !addressChecked(record.emailCheck) && "linkedin" in p && p.linkedin;
          await call(
            "draft_email",
            `first · ${p.name}`,
            note
              ? {
                  ...firstEmail(p),
                  channel: "linkedin",
                  to: note,
                  subject: "",
                  body: `Dear Dr. ${p.name.split(" ").at(-1)}, I'm applying for a funded PhD for Fall 2027 and your work on ${p.niche} is close to mine. Are you taking students?`,
                }
              : firstEmail(p),
          );
          continue;
        }
        await call("propose_professor", `${p.name} · ${p.university}`, {
          name: p.name,
          university: p.university,
          ...(op === "work" ? FIXTURE_WORK[p.name] : { [FIELD_FOR[op]]: VALUE_FOR[op] }),
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
      else if (text.startsWith("[thank-you]")) await thankYou(text);
      else if (text.startsWith("[write]")) await write(text);
      else if (/\bask me\b/i.test(text)) {
        await call("ask_applicant", "English test", {
          question: "Which English test will you take, and when?",
        });
        say("I'll wait for your answer.");
      } else if (/^Find (scholarships|programs)/i.test(text)) await vaultFinds(text);
      else if (/^Suggest schools/i.test(text)) await suggestSchools();
      else if (/^For each program in my Vault, read last cycle's results/i.test(text))
        await decisionTiming();
      else if (/Ask mode/.test(text) && text.includes("\nScope: ")) {
        // A scoped Ask answers from the record the message carries, fetching nothing.
        await pause();
        const line = /^- .+$/m.exec(text.slice(text.indexOf("\nScope: ")))?.[0] ?? "";
        say(`From the sheet, without fetching: ${line.slice(2, 400)}`);
      } else if (n === 0) await hunt();
      else {
        await pause();
        say(`Noted: ${text.slice(0, 120)}`);
      }
      hooks.turnEnded({ durationMs: Date.now() - started, error: stopped ? "interrupted" : null });
      busy = false;
      const next = queue.shift();
      if (next !== undefined) void run(next);
    }

    /** The fake can't read files, but says which ones arrived, so tests see them get through. */
    const received = (files: { name: string }[] | undefined) => {
      if (files?.length) say(`Read ${files.map((f) => f.name).join(", ")}.`);
    };

    hooks.sessionId(`fake-session-${s.threadId}`);
    received(s.firstFiles);
    void run(s.firstText);
    return {
      push(text, _priority, files) {
        received(files);
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
