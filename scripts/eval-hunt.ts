// One live hunt, scored: how many of the funded fits and topic faculty it found, how many of its
// facts check out against their sources, and what it cost. Real Claude, real treg, a temp store:
// it spends your plan and a little treg money, so run it by hand, never in CI. No mailbox is
// connected, so nothing is ever sent.
//
//   node scripts/eval-hunt.ts --label after [--code <checkout>] [--treg] [--port 4320]
//   node scripts/eval-hunt.ts --score <run.json>     re-score a saved run
//
// --code runs another checkout's server (say main, for a before/after); --treg connects the
// treg login from `treg login` (~/.treg/config.json) with a $1 cap. Writes /tmp/gmp-eval-<label>.json.
import { fullName, sameSchool, sameSchoolName } from "../packages/contracts/src/domain.ts";
import {
  type Method,
  type MethodInput,
  type MethodOutput,
  Methods,
} from "../packages/contracts/src/rpc.ts";
import { asArray, asRecord, text } from "../apps/server/src/sources.ts";
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const BENCH = {
  schools: ["University of Utah", "George Mason University"],
  prefs: {
    degrees: ["phd"],
    intake: "Fall 2027",
    fallbackIntake: "Spring 2028",
    places: ["USA"],
    fields: ["natural language processing", "clinical NLP"],
    adjacent: ["machine learning for health"],
    fundingFloor: "full",
    preferTestWaivers: false,
    sweep: { reach: 2, match: 3, safety: 2 },
    priorities: ["money", "topic", "recruiting"],
    followUpDays: [7, 14],
  },
  /** Award keywords for the reference list. */
  terms: ["natural language", "language model", "clinical text", "text mining"],
  /** OpenAlex topics for the reference list, by search. */
  topics: ["natural language processing", "biomedical text mining", "topic modeling"],
  intakeStart: "2027-09-01",
  message:
    "Find every professor at these schools who could fund a PhD student in my fields for Fall 2027, funded or not yet, and propose each one with sources.",
};

const { values: opt } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    code: { type: "string", default: process.cwd() },
    port: { type: "string", default: "4320" },
    treg: { type: "boolean", default: false },
    score: { type: "string" },
    minutes: { type: "string", default: "60" },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return asRecord(await r.json());
};
const rows = (v: unknown) => asArray(v).map(asRecord);
const pageText = async (url: string) => {
  const r = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 getmyprof-eval" },
    signal: AbortSignal.timeout(20_000),
  });
  return (await r.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;|\s+/g, " ");
};
const OA = "mailto=eval@getmyprof.dev";

// ---------------------------------------------------------------- running the hunt

type Run = {
  label: string;
  minutes: number;
  status: string;
  treg: boolean;
  spendUsd: number;
  tools: Record<string, number>;
  turnLog: string;
  professors: Record<string, string>[];
  reply: string;
};

async function runHunt(): Promise<Run> {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `gmp-eval-${opt.label}-`));
  if (opt.treg) {
    const cfg = JSON.parse(
      NodeFS.readFileSync(NodePath.join(NodeOS.homedir(), ".treg/config.json"), "utf8"),
    );
    NodeFS.writeFileSync(NodePath.join(home, "treg.json"), JSON.stringify({ token: cfg.token }), {
      mode: 0o600,
    });
  }
  const log = NodeFS.openSync(NodePath.join(home, "server.log"), "a");
  const server = NodeChild.spawn(
    process.execPath,
    [NodePath.join(opt.code, "apps/server/src/bin.ts")],
    {
      env: {
        ...process.env,
        GETMYPROF_HOME: home,
        SERVER_PORT: opt.port,
        GRADHUNT_DIR: "/nonexistent",
        GETMYPROF_AGENT: "",
      },
      stdio: ["ignore", log, log],
    },
  );
  try {
    for (let i = 0; ; i++) {
      if (
        await fetch(`http://127.0.0.1:${opt.port}/api/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (i > 60) throw new Error(`the server didn't start: ${home}/server.log`);
      await sleep(500);
    }
    const ws = new WebSocket(`ws://127.0.0.1:${opt.port}/ws`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const waiting = new Map<number, (m: Record<string, unknown>) => void>();
    ws.addEventListener("message", (e) => {
      const m = asRecord(JSON.parse(String(e.data)));
      waiting.get(Number(m.id))?.(m);
    });
    let next = 0;
    const call = <M extends Method>(method: M, params: MethodInput<M>) =>
      new Promise<MethodOutput<M>>((resolve, reject) => {
        const id = ++next;
        waiting.set(id, (m) =>
          m.ok
            ? resolve(Methods[method].output.parse(m.result) as MethodOutput<M>)
            : reject(new Error(`${method}: ${JSON.stringify(m.error)}`)),
        );
        ws.send(JSON.stringify({ id, method, params }));
      });
    // Not setupDone: finishing setup would schedule the default loops, which run real turns.
    await call("settings.update", {
      detail: "std",
      treg: opt.treg,
      budget: { perThread: 1, perLoopRun: 1, perDay: 2, askOver: 1 },
      profileSource: "app",
      gradhunt: false,
    });
    await call("hunt.save", { name: "Eval: funded PhD", prefs: BENCH.prefs });
    const started = Date.now();
    const thread = await call("threads.create", {
      text: BENCH.message,
      scope: BENCH.schools.map((name) => ({ kind: "school" as const, name })),
    });
    let view = await call("threads.view", { id: thread.id });
    for (;;) {
      await sleep(15_000);
      view = await call("threads.view", { id: thread.id });
      const s = view.thread.status;
      process.stdout.write(
        `\r${opt.label}: ${s}, ${Math.round((Date.now() - started) / 60_000)} min, ${view.proposals.length} proposed, $${view.thread.spendUsd.toFixed(4)}   `,
      );
      if (s !== "working") break;
      if (Date.now() - started > Number(opt.minutes) * 60_000) {
        await call("threads.stop", { id: thread.id });
        break;
      }
    }
    console.log();
    ws.close();
    const tools: Record<string, number> = {};
    for (const e of view.events) if (e.type === "tool") tools[e.name] = (tools[e.name] ?? 0) + 1;
    const professors = view.proposals
      .filter((p) => p.kind === "add")
      .map((p) => ({
        name: p.recordName,
        university: p.university,
        sources: p.sources.join(" "),
        ...Object.fromEntries(p.changes.map((c) => [c.field, c.to])),
      }));
    const turns =
      NodeFS.readFileSync(NodePath.join(home, "server.log"), "utf8").match(/^turn .*$/gm) ?? [];
    const replies = view.events.flatMap((e) => (e.type === "assistant" ? [e.text] : []));
    return {
      label: opt.label,
      minutes: Math.round((Date.now() - started) / 60_000),
      status: view.thread.status,
      treg: opt.treg,
      spendUsd: view.thread.spendUsd,
      tools,
      turnLog: turns.at(-1) ?? "",
      professors,
      reply: replies.at(-1) ?? "",
    };
  } finally {
    server.kill();
  }
}

// ---------------------------------------------------------------- the reference list

type Ref = { name: string; school: string; why: string; email?: string };

async function institution(school: string) {
  const r = await getJson(
    `https://api.openalex.org/institutions?search=${encodeURIComponent(school)}&per-page=5&${OA}`,
  );
  const found = rows(r.results);
  const hit = found.find((i) => sameSchoolName(text(i.display_name), school)) ?? found[0] ?? {};
  return {
    id: text(hit.id).split("/").pop() ?? "",
    domain: new URL(text(hit.homepage_url) || "https://unknown").hostname.replace(/^www\./, ""),
  };
}

async function reference(
  school: string,
  inst: { id: string },
): Promise<{ funded: Ref[]; topic: Ref[] }> {
  const funded: Ref[] = [];
  for (const term of BENCH.terms) {
    const nsf = await getJson(
      `https://api.nsf.gov/services/v1/awards.json?keyword="${encodeURIComponent(term)}"&awardeeName="${encodeURIComponent(school)}"&expDateStart=${BENCH.intakeStart.slice(5, 7)}/${BENCH.intakeStart.slice(8)}/${BENCH.intakeStart.slice(0, 4)}&printFields=id,piFirstName,piLastName,piEmail&rpp=25`,
    );
    for (const a of rows(asRecord(nsf.response).award))
      funded.push({
        name: `${text(a.piFirstName)} ${text(a.piLastName)}`,
        school,
        why: `NSF ${text(a.id)}`,
        email: text(a.piEmail),
      });
  }
  const nih = await getJson("https://api.reporter.nih.gov/v2/projects/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      criteria: {
        org_names: [school],
        project_end_date: { from_date: BENCH.intakeStart },
        advanced_text_search: {
          operator: "or",
          search_field: "projecttitle,terms,abstracttext",
          search_text: BENCH.terms.map((t) => `"${t}"`).join(" "),
        },
      },
      include_fields: ["ProjectNum", "ContactPiName"],
      limit: 100,
    }),
  });
  for (const p of rows(nih.results))
    funded.push({
      name: text(p.contact_pi_name).split(",").toReversed().join(" ").trim(),
      school,
      why: `NIH ${text(p.project_num)}`,
    });
  const topicIds: string[] = [];
  for (const t of BENCH.topics) {
    const r = await getJson(
      `https://api.openalex.org/topics?search=${encodeURIComponent(t)}&per-page=2&${OA}`,
    );
    topicIds.push(...rows(r.results).map((x) => text(x.id).split("/").pop() ?? ""));
  }
  const authors = await getJson(
    `https://api.openalex.org/authors?filter=last_known_institutions.id:${inst.id},topics.id:${topicIds.join("|")},summary_stats.h_index:>11&per-page=60&${OA}`,
  );
  const topic: Ref[] = rows(authors.results).map((a) => ({
    name: text(a.display_name),
    school,
    why: `OpenAlex h${text(asRecord(a.summary_stats).h_index)}`,
  }));
  const one = (list: Ref[]) => [...new Map(list.map((r) => [fullName(r.name), r])).values()];
  return { funded: one(funded), topic: one(topic) };
}

// ---------------------------------------------------------------- checking each fact

type Verdict = "ok" | "bad" | "none";

async function checkMoney(p: Record<string, string>): Promise<Verdict> {
  const tier = Number(p.moneyTier ?? 0);
  if (tier !== 1 && tier !== 2) return "none";
  const last =
    fullName(p.name ?? "")
      .split(" ")
      .at(-1) ?? "";
  const urls =
    `${p.sources ?? ""} ${p.grants ?? ""} ${p.money ?? ""}`.match(/https?:\/\/[^\s,;)"]+/g) ?? [];
  for (const url of urls) {
    const nsf = /AWD_ID=(\d+)/.exec(url)?.[1];
    try {
      if (nsf) {
        const a = (
          await getJson(
            `https://api.nsf.gov/services/v1/awards/${nsf}.json?printFields=piLastName,expDate`,
          )
        ).response.award?.[0];
        if (a && fullName(a.piLastName).includes(last)) return "ok";
        continue;
      }
      if ((await pageText(url)).toLowerCase().includes(last)) return "ok";
    } catch {
      // A page that won't load proves nothing either way; try the next.
    }
  }
  return "bad";
}

async function checkQuote(p: Record<string, string>): Promise<Verdict> {
  const quote = /"([^"]{20,})"/.exec(`${p.taking ?? ""} ${p.contact ?? ""}`)?.[1];
  if (!quote) return "none";
  const want = quote.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
  const urls = `${p.website ?? ""} ${p.sources ?? ""}`.match(/https?:\/\/[^\s,;)"]+/g) ?? [];
  for (const url of urls.slice(0, 4))
    if (
      (await pageText(url).catch(() => ""))
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .includes(want)
    )
      return "ok";
  return "bad";
}

const checkEmail = (p: Record<string, string>, domain: string): Verdict =>
  !p.email
    ? "none"
    : p.email.toLowerCase().endsWith(domain.split(".").slice(-2).join("."))
      ? "ok"
      : "bad";

async function checkIdentity(p: Record<string, string>, inst: { id: string }): Promise<Verdict> {
  const r = await getJson(
    `https://api.openalex.org/authors?search=${encodeURIComponent(p.name ?? "")}&filter=last_known_institutions.id:${inst.id}&per-page=1&${OA}`,
  ).catch(() => null);
  return r?.results?.length ? "ok" : "bad";
}

// ---------------------------------------------------------------- the score

async function score(run: Run) {
  const schools = await Promise.all(
    BENCH.schools.map(async (s) => ({ name: s, inst: await institution(s) })),
  );
  const refs = await Promise.all(schools.map((s) => reference(s.name, s.inst)));
  const funded = refs.flatMap((r) => r.funded);
  const topic = refs.flatMap((r) => r.topic);
  const found = (r: Ref) =>
    run.professors.some(
      (p) =>
        fullName(p.name ?? "") === fullName(r.name) && sameSchool(p.university ?? "", r.school),
    );
  const checks = await Promise.all(
    run.professors.map(async (p) => {
      const at = schools.find((s) => sameSchool(p.university ?? "", s.name));
      return {
        name: p.name,
        school: at ? "ok" : "bad",
        identity: at ? await checkIdentity(p, at.inst) : "bad",
        email: at ? checkEmail(p, at.inst.domain) : "none",
        emailVerified: p.emailCheck
          ? /verif|deliver|valid/i.test(p.emailCheck)
            ? "ok"
            : "bad"
          : "none",
        money: await checkMoney(p),
        quote: await checkQuote(p),
      } as const;
    }),
  );
  const rate = (k: keyof (typeof checks)[number]) => {
    const ok = checks.filter((c) => c[k] === "ok").length;
    const bad = checks.filter((c) => c[k] === "bad").length;
    return { ok, bad, rate: ok + bad ? Math.round((100 * ok) / (ok + bad)) : null };
  };
  const report = {
    run: { label: run.label, minutes: run.minutes, status: run.status, treg: run.treg },
    quantity: {
      proposed: run.professors.length,
      fundedFound: `${funded.filter(found).length} of ${funded.length}`,
      fundedMissed: funded.filter((r) => !found(r)).map((r) => `${r.name} (${r.why})`),
      topicFound: `${topic.filter(found).length} of ${topic.length}`,
      topicMissed: topic.filter((r) => !found(r)).map((r) => `${r.name} (${r.why})`),
      withEmail: run.professors.filter((p) => p.email).length,
    },
    quality: {
      atTheSchool: rate("school"),
      identity: rate("identity"),
      emailDomain: rate("email"),
      emailVerified: rate("emailVerified"),
      moneyBacked: rate("money"),
      quoteOnPage: rate("quote"),
      failures: checks.filter((c) => Object.values(c).includes("bad")),
    },
    cost: { tregUsd: run.spendUsd, toolCalls: run.tools, model: run.turnLog },
  };
  return report;
}

const run: Run = opt.score
  ? JSON.parse(NodeFS.readFileSync(opt.score, "utf8")).run
  : await runHunt();
const out = { run, report: await score(run) };
const file = `/tmp/gmp-eval-${run.label}.json`;
NodeFS.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.report, null, 2));
console.log(`saved ${file}`);
