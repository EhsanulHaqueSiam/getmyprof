// Bridges to Siam's install (gradhunt records, hq facts) and CSV for everyone. Each adapter
// reads its source on demand; gradhunt writes go back only through scout.py, one at a time.
import {
  type Change,
  type FactKind,
  Professor,
  type ProfileFact,
  Stage,
} from "@getmyprof/contracts";
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { z } from "zod";
import { type Db, now } from "./db.ts";
import { getRecord, listRecords, putRecord, recordKey } from "./records.ts";
import { getFacts, getSettings } from "./state.ts";

const s = (v: unknown) => (v == null ? "" : String(v));

export const hqDir = (env = process.env) =>
  env.HQ_DIR ?? NodePath.join(NodeOS.homedir(), "Personal/hq");

/** hq files facts by folder (papers/, projects/, roles/) or name (education*.md). */
function hqKind(file: string): FactKind {
  if (file.startsWith("papers/")) return "paper";
  if (file.startsWith("projects/")) return "project";
  if (file.startsWith("roles/")) return "work";
  if (file.startsWith("education")) return "education";
  if (/english|ielts|toefl|gre/i.test(file)) return "test";
  return "other";
}

/** hq's fact notes as confirmed, read-only profile facts: title and description, with the note as source. */
export function readHqFacts(dir = hqDir()): ProfileFact[] {
  const root = NodePath.join(dir, "facts");
  if (!NodeFS.existsSync(root)) return [];
  const files = NodeFS.readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".md") && !f.endsWith("index.md"),
  );
  return files.flatMap((file) => {
    const text = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const field = (k: string) =>
      new RegExp(`^${k}:\\s*(.+)$`, "m")
        .exec(fm)?.[1]
        ?.replace(/^["']|["']$/g, "")
        .trim() ?? "";
    const title = field("title");
    if (!title) return [];
    const description = field("description");
    return [
      {
        id: `hq:${file}`,
        text: description ? `${title}: ${description}` : title,
        source: `hq/facts/${file}`,
        kind: hqKind(file),
        // The note's own date, or when its span ended (or began, if it still runs).
        date: (field("date") || field("end") || field("start") || field("issued")).slice(0, 10),
        confirmed: true,
        question: false,
        planned: false,
      },
    ];
  });
}

/** The applicant's facts: hq's on an install that reads hq, the app's own otherwise. */
export const profileFacts = (db: Db) =>
  getSettings(db).profileSource === "hq" ? readHqFacts() : getFacts(db);

export const gradhuntDir = (env = process.env) =>
  env.GRADHUNT_DIR ?? NodePath.join(NodeOS.homedir(), "Personal/gradhunt");
const sheetPath = (dir: string) => NodePath.join(dir, "loopany/prof-scout/data/professors.json");

/**
 * Scout, gradhunt's nightly loop, as the Loops table shows it: its latest Timeline entry in its
 * README and the professors it added in the last 7 days. Null where there is no gradhunt.
 */
export function scoutLoop(dir = gradhuntDir(), nowAt = new Date()) {
  let readme: string;
  let sheet: unknown;
  try {
    readme = NodeFS.readFileSync(NodePath.join(dir, "loopany/prof-scout/README.md"), "utf8");
    sheet = JSON.parse(NodeFS.readFileSync(sheetPath(dir), "utf8"));
  } catch {
    return null;
  }
  // Entries read "- **2026-10-02 (run 23)** — what happened", wrapped over indented lines,
  // one per run, newest last; the section ends at the next heading.
  const timeline = readme.slice(readme.indexOf("## Timeline")).split(/\n(?=#)/)[0] ?? "";
  const entry =
    timeline
      .split(/\n(?=- \*\*)/)
      .at(-1)
      ?.replace(/\s+/g, " ") ?? "";
  const last = /^- \*\*(.+?)\*\*\s*[—-]\s*(.+)$/.exec(entry.trim());
  const since = new Date(nowAt.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const rows = Array.isArray(sheet) ? sheet : [];
  return {
    // Its own schedule (Asia/Dhaka), set outside getmyprof.
    when: "nightly 23:00, Asia/Dhaka",
    lastRun: last?.[1] ?? "",
    summary: (last?.[2] ?? "").slice(0, 160),
    found7d: rows.filter((r) => {
      const added = z.object({ date_added: z.string() }).safeParse(r);
      return added.success && added.data.date_added.slice(0, 10) >= since;
    }).length,
  };
}

const STAGE: Record<string, Professor["stage"]> = {
  new: "new",
  drafted: "drafted",
  sent: "sent",
  replied: "replied",
};

const GradhuntWork = z.union([
  z.string(),
  z
    .object({ title: z.string(), year: z.unknown() })
    .transform((w) => `${s(w.year)} ${w.title}`.trim()),
]);
/** gradhunt's recent_works, newest first, as one line: it holds a line, strings or {title, year}. */
const recentLine = (works: unknown) =>
  typeof works === "string"
    ? works
    : (z.array(GradhuntWork).safeParse(works).data ?? []).slice(0, 3).join("; ");

/**
 * Copies gradhunt's sheet into the store. Rows getmyprof already holds keep their local edits;
 * their Scholar link and recent work fill in only where getmyprof has none.
 */
export function importGradhunt(db: Db, dir = gradhuntDir()) {
  const file = sheetPath(dir);
  if (!NodeFS.existsSync(file)) return 0;
  const rows: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  let added = 0;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = raw as Record<string, unknown>;
    const name = s(r.name);
    const university = s(r.university);
    if (!name || !university) continue;
    const scholar = s(r.scholar_url);
    const recent = recentLine(r.recent_works);
    const known = getRecord(db, recordKey(name, university));
    if (known) {
      if (known.origin === "gradhunt" && ((scholar && !known.scholar) || (recent && !known.recent)))
        putRecord(db, {
          ...known,
          scholar: known.scholar || scholar,
          recent: known.recent || recent,
        });
      continue;
    }
    const contact = s(r.contact) || "email";
    putRecord(
      db,
      Professor.parse({
        key: recordKey(name, university),
        name,
        university,
        department: s(r.department),
        niche: s(r.subject),
        fit: Math.max(0, Math.min(5, Number(r.fit) || 0)),
        taking: "",
        money: s(r.funding_evidence).slice(0, 160),
        lasts: "",
        email: s(r.email),
        emailCheck: s(r.email_check).split(" ")[0] ?? "",
        contact: [contact, s(r.contact_note)].filter(Boolean).join(": ").slice(0, 200),
        stage: contact === "apply-only" ? "apply-only" : (STAGE[s(r.status)] ?? "new"),
        fitsBecause: s(r.notes).slice(0, 200),
        website: s(r.website),
        linkedin: s(r.linkedin),
        scholar,
        recent,
        sources: (Array.isArray(r.sources) ? r.sources.map(s) : s(r.sources).split(/;\s*/)).filter(
          Boolean,
        ),
        grants: [],
        origin: "gradhunt",
        updatedAt: now(),
      }),
    );
    added++;
  }
  return added;
}

/** getmyprof fields scout.py can take, and their gradhunt names. Others stay local to getmyprof. */
const SCOUT_FIELDS: Partial<Record<Change["field"], string>> = {
  fit: "fit",
  email: "email",
  emailCheck: "email_check",
  money: "funding_evidence",
  niche: "subject",
  website: "website",
};

let scoutQueue: Promise<unknown> = Promise.resolve();

/** Writes accepted changes to a gradhunt row through `scout.py set`, queued so writes never overlap. */
export function writeBackToGradhunt(p: Professor, changes: Change[], dir = gradhuntDir()) {
  const pairs = changes.flatMap((c) => {
    const field = SCOUT_FIELDS[c.field];
    if (!field) return [];
    return [`${field}=${field === "email_check" ? `${c.to} ${now().slice(0, 10)}` : c.to}`];
  });
  if (p.origin !== "gradhunt" || pairs.length === 0) return scoutQueue;
  scoutQueue = scoutQueue.then(
    () =>
      new Promise<void>((resolve) =>
        NodeChild.execFile(
          NodePath.join(dir, "scout.py"),
          ["set", p.name, p.university, ...pairs],
          { cwd: dir, timeout: 60_000 },
          (err) => {
            if (err) console.error(`scout.py set ${p.name}: ${err.message.slice(0, 200)}`);
            resolve();
          },
        ),
      ),
  );
  return scoutQueue;
}

const CSV_FIELDS = [
  "name",
  "university",
  "department",
  "niche",
  "fit",
  "taking",
  "money",
  "lasts",
  "email",
  "emailCheck",
  "contact",
  "stage",
  "fitsBecause",
  "website",
  "linkedin",
  "scholar",
  "recent",
  "seeking",
  "lab",
  "warm",
  "hook",
  "sources",
] as const;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export function exportCsv(db: Db) {
  const lines = listRecords(db).map((p) =>
    CSV_FIELDS.map((f) => csvCell(f === "sources" ? p.sources.join(" ") : String(p[f]))).join(","),
  );
  return [CSV_FIELDS.join(","), ...lines].join("\n");
}

/** RFC 4180-ish parsing: quoted cells, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) {
    endCell();
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Adds rows from a CSV with getmyprof's export header. Existing people are left alone. */
export function importCsv(db: Db, text: string) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return 0;
  const col = (r: string[], f: string) => r[header.indexOf(f)] ?? "";
  let added = 0;
  for (const r of rows) {
    const name = col(r, "name").trim();
    const university = col(r, "university").trim();
    if (!name || !university || getRecord(db, recordKey(name, university))) continue;
    const stage = Stage.safeParse(col(r, "stage"));
    putRecord(
      db,
      Professor.parse({
        key: recordKey(name, university),
        name,
        university,
        department: col(r, "department"),
        niche: col(r, "niche"),
        fit: Math.max(0, Math.min(5, Number(col(r, "fit")) || 0)),
        taking: col(r, "taking"),
        money: col(r, "money"),
        lasts: col(r, "lasts"),
        email: col(r, "email"),
        emailCheck: col(r, "emailCheck"),
        contact: col(r, "contact"),
        stage: stage.success ? stage.data : "new",
        fitsBecause: col(r, "fitsBecause"),
        website: col(r, "website"),
        linkedin: col(r, "linkedin"),
        scholar: col(r, "scholar"),
        recent: col(r, "recent"),
        seeking: col(r, "seeking"),
        lab: col(r, "lab"),
        warm: col(r, "warm"),
        hook: col(r, "hook"),
        sources: col(r, "sources").split(/\s+/).filter(Boolean),
        grants: [],
        origin: "app",
        updatedAt: now(),
      }),
    );
    added++;
  }
  return added;
}
