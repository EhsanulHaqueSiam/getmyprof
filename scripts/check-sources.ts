// Is every source the hunt reads working, and are professors' pages really read? No agent, no
// money: each free source gets one real query, then every CSRankings faculty homepage at the
// schools goes through the contact-page reader, and pages it can't read are tried again through
// treg's free fetch (renders JavaScript) to show what that would recover.
//
//   node scripts/check-sources.ts [--pages "University of Utah" "George Mason University"]
//
// Uses a temp GETMYPROF_HOME for its caches; treg's free endpoints use `treg login`'s token.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

process.env.GETMYPROF_HOME ??= NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmp-check-"));
// The temp home gets the treg login, so the contact-page reader can fall back to treg's fetch.
const tregToken = String(
  JSON.parse(NodeFS.readFileSync(NodePath.join(NodeOS.homedir(), ".treg/config.json"), "utf8"))
    .token,
);
NodeFS.writeFileSync(
  NodePath.join(process.env.GETMYPROF_HOME, "treg.json"),
  JSON.stringify({ token: tregToken }),
  { mode: 0o600 },
);
const { realSources: src } = await import("../apps/server/src/agent/sourcing.ts");
const { tregCall, tregText } = await import("../apps/server/src/treg.ts");

const after = "2027-09-01";
const nlp = ["natural language processing"];
const treg = (endpoint: string, data: Record<string, unknown>) =>
  tregCall({ endpoint, data, maxUsd: 0, tags: { feature: "check" } }, { token: tregToken }).then(
    (r) => {
      if (!r.ok) throw new Error(r.reason);
      return tregText(r.result).split("\n").filter(Boolean);
    },
  );

const CHECKS: [string, () => Promise<unknown[] | unknown>][] = [
  [
    "nsf_awards (NSF)",
    () => src.nsf({ terms: nlp, university: "George Mason University", activeAfter: after }),
  ],
  [
    "nih_awards (NIH RePORTER)",
    () =>
      src.nih({ terms: ["clinical text"], university: "University of Utah", activeAfter: after }),
  ],
  ["country_awards UKRI", () => src.ukri({ terms: nlp, university: "University of Edinburgh" })],
  ["country_awards CORDIS", () => src.cordis({ terms: nlp })],
  ["country_awards ARC", () => src.arc({ terms: nlp, university: "University of Melbourne" })],
  ["country_awards DFG", () => src.dfg({ terms: ["Sprachverarbeitung"] })],
  ["country_awards NSERC", () => src.nserc({ terms: nlp, university: "University of Toronto" })],
  ["phd_positions jobs.ac.uk", () => src.jobsacuk({ terms: ["machine learning"] })],
  ["phd_positions INSPIRE", () => src.inspire({ terms: ["particle physics"] })],
  ["csrankings_faculty", () => src.csrankings("University of Utah")],
  [
    "openalex_author",
    () => src.openalex("Vivek Srikumar", "University of Utah").then((a) => (a ? [a] : [])),
  ],
  ["openalex_by_topic", () => src.byTopic("natural language processing", "University of Utah")],
  [
    "lab_members",
    () => src.lab("Vivek Srikumar", "University of Utah").then((l) => (l ? [l] : [])),
  ],
  ["read_contact_rule", () => src.contactPage("https://ziyuyao.org").then((r) => r.statements)],
  [
    "treg web_search (tinyfish)",
    () => treg("tinyfish.web.search", { query: "clinical NLP faculty University of Utah" }),
  ],
  [
    "treg scholar_search (tinyfish)",
    () => treg("tinyfish.web.search.publications", { query: "clinical information extraction" }),
  ],
  [
    "treg page fetch (tinyfish)",
    () => treg("tinyfish.web.fetch", { urls: ["https://svivek.com"], format: "markdown" }),
  ],
  ["treg verify_email", () => treg("treg.people.email.verify", { email: "svivek@cs.utah.edu" })],
];

console.log("Sources");
for (const [name, run] of CHECKS) {
  const t0 = Date.now();
  try {
    const out = await run();
    const n = Array.isArray(out) ? out.length : 1;
    console.log(`  ${n ? "ok  " : "EMPTY"} ${name}: ${n} in ${Date.now() - t0} ms`);
  } catch (error) {
    console.log(`  FAIL ${name}: ${String(error).slice(0, 160)}`);
  }
}

// ---------------------------------------------------------------- every faculty page at the schools

const flag = process.argv.indexOf("--pages");
const schools = flag > 0 ? process.argv.slice(flag + 1) : [];
for (const school of schools) {
  const faculty = (await src.csrankings(school)).filter((f) => /^https?:/.test(f.homepage));
  const tally = { read: 0, failed: 0, thin: 0, statement: 0, email: 0, recovered: 0 };
  const failures: string[] = [];
  let next = 0;
  // Six at a time: polite to departments' servers, quick enough for a few hundred pages.
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let f = faculty[next++]; f; f = faculty[next++]) {
        const r = await src.contactPage(f.homepage).catch((e: unknown) => String(e));
        if (typeof r === "string") {
          tally.failed++;
          // Would the rendering fetch have read it?
          const page = await treg("tinyfish.web.fetch", {
            urls: [f.homepage],
            format: "markdown",
          }).catch(() => []);
          if (page.join(" ").length > 400) tally.recovered++;
          failures.push(`${f.name}: ${f.homepage} (${r.slice(0, 60)})`);
          continue;
        }
        tally.read++;
        if (!r.statements.length && !r.emails.length && !r.noEmail && !r.applyFirst) tally.thin++;
        if (r.statements.length) tally.statement++;
        if (r.emails.length) tally.email++;
      }
    }),
  );
  console.log(`\nPages at ${school}: ${faculty.length} homepages`);
  console.log(
    `  read ${tally.read}, failed ${tally.failed} (treg's fetch recovers ${tally.recovered})`,
  );
  console.log(
    `  a taking statement on ${tally.statement}, an email on ${tally.email}, nothing useful on ${tally.thin}`,
  );
  for (const line of failures.slice(0, 12)) console.log(`  failed: ${line}`);
}
