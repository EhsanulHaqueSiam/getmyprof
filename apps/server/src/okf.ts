// The Vault as an OKF v0.2 bundle, like hq: one markdown note per fact, document, program,
// application, offer, piece of writing and professor, each with a typed front-matter header and
// relative links between them. gradcode writes it one way from the store to
// GRADCODE_HOME/vault, for Obsidian and for search; edits happen in the app. A full-text index
// of the notes (plus hq's own notes on an install that reads hq) backs the agent's vault_search.
import type { ProfileFact } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { hqDir, profileFacts } from "./adapters.ts";
import { type Db, homeDir } from "./db.ts";
import { listRecords } from "./records.ts";
import { getSettings } from "./state.ts";
import { listApplications, listDocuments, listOffers, listPrograms, listWriting } from "./vault.ts";

export type Note = {
  /** Relative to the bundle, e.g. "facts/papers/fair-triage-2a1b3c.md". */
  path: string;
  type: string;
  title: string;
  fields: Record<string, string | number | boolean | string[] | null>;
  body: string;
  /** Paths of the notes it links to. */
  links: string[];
};

const FACT_PLACE = {
  education: ["facts/education", "Education"],
  paper: ["facts/papers", "Paper"],
  project: ["facts/projects", "Project"],
  test: ["facts/tests", "Fact"],
  work: ["facts/roles", "Role"],
  other: ["facts/other", "Fact"],
} as const satisfies Record<ProfileFact["kind"], readonly [string, string]>;

const slug = (text: string, id: string) =>
  `${
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "note"
  }-${id.replace(/[^a-z0-9]/gi, "").slice(-6)}`;

/** Every vault item as a note, linked to the notes it rests on. On an hq install hq keeps the facts. */
export function bundleNotes(db: Db): Note[] {
  const hq = getSettings(db).profileSource === "hq";
  const facts = hq ? [] : profileFacts(db);
  const docs = listDocuments(db);
  const programs = listPrograms(db);
  const records = listRecords(db);
  const notes: Note[] = [];

  const docPath = new Map(docs.map((d) => [d.id, `documents/${slug(d.name, d.id)}.md`]));
  const factPath = new Map(
    facts.map((f) => [f.id, `${FACT_PLACE[f.kind][0]}/${slug(f.text, f.id)}.md`]),
  );
  const programPath = new Map(
    programs.map((p) => [p.id, `hunt/programs/${slug(`${p.university} ${p.name}`, p.id)}.md`]),
  );
  const profPath = new Map(
    records.map((r) => [r.key, `hunt/professors/${slug(r.name, r.key)}.md`]),
  );

  for (const f of facts) {
    // A fact proved by a vault document links to it; a URL or "CV p1" stays as text.
    const proof = docs.find((d) => d.id === f.source || d.name === f.source);
    notes.push({
      path: factPath.get(f.id) ?? "",
      type: FACT_PLACE[f.kind][1],
      title: f.text,
      fields: {
        description: f.text,
        date: f.date || null,
        sources: [f.source].filter(Boolean),
        confirmed: f.confirmed,
        public: false,
      },
      body: f.question ? "Waiting on an answer: the source doesn't prove it yet." : "",
      links: proof ? [docPath.get(proof.id) ?? ""] : [],
    });
  }
  for (const d of docs)
    notes.push({
      path: docPath.get(d.id) ?? "",
      type: "Document",
      title: d.name,
      fields: {
        description: `${d.kind} uploaded ${d.uploadedAt.slice(0, 10)}`,
        kind: d.kind,
        file: `../../files/${d.id}`,
        expires: d.expires,
      },
      body: "",
      links: [],
    });
  for (const p of programs)
    notes.push({
      path: programPath.get(p.id) ?? "",
      type: "Program",
      title: `${p.university} · ${p.name}`,
      fields: {
        description: p.funding || p.name,
        university: p.university,
        degree: p.degree,
        deadline: p.deadline,
        fee: p.fee,
        english: p.english,
        url: p.url,
        sources: p.sources,
      },
      body: p.note,
      links: [],
    });
  for (const r of records)
    notes.push({
      path: profPath.get(r.key) ?? "",
      type: "Professor",
      title: `${r.name} · ${r.university}`,
      fields: {
        description: r.niche,
        university: r.university,
        fit: r.fit,
        money_tier: r.moneyTier,
        money: r.money,
        taking: r.taking,
        email: r.email,
        stage: r.stage,
        sources: r.sources,
      },
      body: r.fitsBecause,
      links: [],
    });
  for (const a of listApplications(db)) {
    const program = programs.find((p) => p.id === a.programId);
    notes.push({
      path: `hunt/applications/${slug(program?.name ?? "application", a.id)}.md`,
      type: "Application",
      title: `Application · ${program ? `${program.university} · ${program.name}` : a.programId}`,
      fields: {
        description: `${a.status}${a.submittedAt ? `, submitted ${a.submittedAt.slice(0, 10)}` : ""}`,
        status: a.status,
        submitted: a.submittedAt,
        application_id: a.applicationId || null,
      },
      body: a.note,
      links: [
        programPath.get(a.programId) ?? "",
        ...a.professors.map((k) => profPath.get(k) ?? ""),
        ...a.documents.flatMap((d) => (d.docId ? [docPath.get(d.docId) ?? ""] : [])),
      ].filter(Boolean),
    });
  }
  for (const o of listOffers(db))
    notes.push({
      path: `hunt/offers/${slug(`${o.university} ${o.program}`, o.id)}.md`,
      type: "Offer",
      title: `Offer · ${o.university} · ${o.program}`,
      fields: {
        description: `${o.status}${o.stipend ? `, ${o.currency} ${o.stipend} a ${o.stipendPer}` : ""}`,
        status: o.status,
        respond_by: o.respondBy,
      },
      body: o.note,
      links: [],
    });
  for (const w of listWriting(db))
    notes.push({
      path: `writing/${slug(w.title, w.id)}.md`,
      type: "Writing",
      title: w.title,
      fields: { description: `${w.kind}, draft ${w.draft}`, kind: w.kind, draft: w.draft },
      body: w.body,
      links: Object.values(w.citations).flatMap((id) => factPath.get(id) ?? []),
    });
  return notes;
}

const yaml = (v: Note["fields"][string]) =>
  v === null ? "null" : typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);

/** A note as markdown: the typed header, the body, then its links as relative markdown links. */
export function renderNote(n: Note, all: Map<string, Note>) {
  const header = [
    "---",
    `type: ${n.type}`,
    `title: ${JSON.stringify(n.title)}`,
    ...Object.entries(n.fields).map(([k, v]) => `${k}: ${yaml(v)}`),
    'generated: {by: "process:gradcode"}',
    "---",
  ].join("\n");
  const related = n.links
    .map((p) => all.get(p))
    .filter((x) => x !== undefined)
    .map((x) => `- [${x.title}](${NodePath.relative(NodePath.dirname(n.path), x.path)})`);
  return [header, n.body, related.length ? `## Related\n${related.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

export const bundleDir = () => NodePath.join(homeDir(), "vault");

/** Writes the bundle and replaces what was there, so a removed item's note goes too. */
export function writeBundle(notes: Note[], dir = bundleDir()) {
  const all = new Map(notes.map((n) => [n.path, n]));
  NodeFS.rmSync(dir, { recursive: true, force: true });
  for (const n of notes) {
    const file = NodePath.join(dir, n.path);
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, renderNote(n, all));
  }
  // One index per folder, so Obsidian and the agent can walk it.
  const folders = new Map<string, Note[]>();
  for (const n of notes)
    folders.set(NodePath.dirname(n.path), [...(folders.get(NodePath.dirname(n.path)) ?? []), n]);
  for (const [folder, inside] of folders)
    NodeFS.writeFileSync(
      NodePath.join(dir, folder, "index.md"),
      `---\ntype: Guide\ntitle: ${JSON.stringify(folder)}\n---\n\n${inside.map((n) => `- [${n.title}](${NodePath.basename(n.path)})`).join("\n")}\n`,
    );
  NodeFS.mkdirSync(dir, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(dir, "okf-base.yaml"),
    'okf_version: "0.2"\nbase:\n  name: gradcode vault\n  reserved_files: {index: index.md}\n',
  );
}

/** hq's own notes, read-only, for search on an install that reads hq. */
function hqNotes(dir = hqDir()): Note[] {
  return ["facts", "documents", "decisions", "research"].flatMap((folder) => {
    const root = NodePath.join(dir, folder);
    if (!NodeFS.existsSync(root)) return [];
    return NodeFS.readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md") && !f.endsWith("index.md"))
      .map((f) => {
        const text = NodeFS.readFileSync(NodePath.join(root, f), "utf8");
        const field = (k: string) =>
          new RegExp(`^${k}:\\s*(.+)$`, "m").exec(text)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
        return {
          path: `hq/${folder}/${f}`,
          type: field("type") || "Note",
          title: field("title") || f,
          fields: {},
          body: text.replace(/^---\n[\s\S]*?\n---\n?/, ""),
          links: [...text.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) =>
            NodePath.join("hq", folder, NodePath.dirname(f), m[1] ?? ""),
          ),
        };
      });
  });
}

/** Rebuilds the bundle on disk and the search index. Cheap enough to run after every change. */
export function refreshVault(db: Db) {
  const notes = bundleNotes(db);
  writeBundle(notes);
  const indexed = getSettings(db).profileSource === "hq" ? [...notes, ...hqNotes()] : notes;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM notes");
    const put = db.prepare(
      "INSERT INTO notes (path, type, title, body, links) VALUES (?, ?, ?, ?, ?)",
    );
    for (const n of indexed)
      put.run(
        n.path,
        n.type,
        n.title,
        `${Object.values(n.fields).flat().filter(Boolean).join(" ")}\n${n.body}`,
        JSON.stringify(n.links),
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * The notes that best match a query, each with what it links to and what links to it, so the
 * agent finds a fact and its proof, or a role and the paper that came from it, in one call.
 */
export function searchVault(db: Db, query: string, limit = 6) {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return [];
  const match = words.map((w) => `"${w}"`).join(" OR ");
  const hits = db
    .prepare(
      `SELECT path, type, title, links, snippet(notes, 3, '', '', ' ... ', 16) AS snip
       FROM notes WHERE notes MATCH ? ORDER BY bm25(notes) LIMIT ?`,
    )
    .all(match, limit);
  const titleOf = (path: string) =>
    String(db.prepare("SELECT title FROM notes WHERE path = ?").get(path)?.title ?? "");
  return hits.map((h) => {
    const path = String(h.path);
    const out: string[] = JSON.parse(String(h.links));
    const back = db
      .prepare("SELECT path FROM notes WHERE links LIKE ? LIMIT 8")
      .all(`%${JSON.stringify(path).slice(1, -1)}%`)
      .map((r) => String(r.path));
    return {
      path,
      type: String(h.type),
      title: String(h.title),
      snippet: String(h.snip).replace(/\s+/g, " ").trim(),
      linked: [...new Set([...out, ...back])]
        .filter((p) => p !== path)
        .map((p) => ({ path: p, title: titleOf(p) })),
    };
  });
}
