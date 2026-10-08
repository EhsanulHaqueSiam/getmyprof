// Who a professor works with, by OpenAlex: their frequent co-authors (the lab, likely students
// and alumni), and papers that link them to the applicant's own co-authors. Free and read-only;
// the agent reads them through lab_members and warm_paths (agent/people-tools.ts).
import { asArray, asRecord, getJson, lastInstitution, openAlexMatch, text } from "./sources.ts";

const API = "https://api.openalex.org";
const WORK_FIELDS = "id,title,publication_year,doi,authorships";
/** "https://openalex.org/A123" as "A123". */
const shortId = (v: unknown) => text(v).split("/").pop() ?? "";

type Institution = { id: string; name: string };
const institutions = (v: unknown): Institution[] =>
  asArray(v)
    .map(asRecord)
    .map((i) => ({ id: shortId(i.id), name: text(i.display_name) }));
const names = (list: Institution[]) => list.map((i) => i.name).join(", ");

export type Work = {
  title: string;
  year: number;
  link: string;
  authors: { id: string; name: string; first: boolean; at: Institution[] }[];
};

/** An OpenAlex works page as works and their authors, in byline order. */
export const parseWorks = (body: unknown): Work[] =>
  asArray(asRecord(body).results)
    .map(asRecord)
    .map((w) => ({
      title: text(w.title),
      year: Number(w.publication_year) || 0,
      link: text(w.doi) || text(w.id),
      authors: asArray(w.authorships)
        .map(asRecord)
        .map((a) => ({
          id: shortId(asRecord(a.author).id),
          name: text(asRecord(a.author).display_name),
          first: a.author_position === "first",
          at: institutions(a.institutions),
        })),
    }));

export type CoAuthor = {
  id: string;
  name: string;
  link: string;
  shared: number;
  lastYear: number;
  /** The institution on their latest shared work. */
  institution: string;
  /** Where OpenAlex last saw them, when that's somewhere else. */
  now: string;
  /** At the professor's school, and first author on a shared work. */
  student: boolean;
  /** Last wrote with them 2+ years ago, and somewhere else now. */
  alumnus: boolean;
};

/**
 * A professor's frequent co-authors (2+ shared works), most shared first. `home` holds the
 * professor's institution ids; `current` is where OpenAlex last saw each co-author, by id.
 */
export function coAuthors(
  professorId: string,
  home: string[],
  works: Work[],
  year: number,
  current = new Map<string, Institution[]>(),
): CoAuthor[] {
  const seen = new Map<
    string,
    { name: string; shared: number; lastYear: number; at: Institution[]; first: boolean }
  >();
  for (const w of works)
    for (const a of w.authors) {
      if (!a.id || a.id === professorId) continue;
      const c = seen.get(a.id) ?? { name: a.name, shared: 0, lastYear: 0, at: [], first: false };
      c.shared++;
      c.first ||= a.first;
      if (w.year > c.lastYear) {
        c.lastYear = w.year;
        c.at = a.at;
      }
      seen.set(a.id, c);
    }
  return [...seen]
    .filter(([, c]) => c.shared >= 2)
    .map(([id, c]) => {
      const lastSeen = current.get(id) ?? [];
      const now = lastSeen.length ? lastSeen : c.at;
      const atHome = now.some((i) => home.includes(i.id));
      return {
        id,
        name: c.name,
        link: `https://openalex.org/${id}`,
        shared: c.shared,
        lastYear: c.lastYear,
        institution: names(c.at),
        now: names(now) === names(c.at) ? "" : names(now),
        student: atHome && c.first,
        alumnus: c.lastYear <= year - 2 && !atHome,
      };
    })
    .toSorted((a, b) => b.shared - a.shared || b.lastYear - a.lastYear);
}

/** Where OpenAlex last saw each author, by id: one request, and nothing when it fails. */
async function whereNow(ids: string[]) {
  const body = ids.length
    ? await getJson(
        `${API}/authors?filter=ids.openalex:${ids.join("|")}&per-page=50&select=id,last_known_institutions`,
      ).catch(() => null)
    : null;
  return new Map<string, Institution[]>(
    asArray(asRecord(body).results)
      .map(asRecord)
      .map((a) => [shortId(a.id), institutions(a.last_known_institutions)]),
  );
}

export type Lab = {
  name: string;
  institution: string;
  /** Their works since `since`, the year the count starts. */
  works: number;
  since: number;
  coAuthors: CoAuthor[];
};

/** A professor's lab by OpenAlex: who wrote with them in the last 5 years. Null if not found. */
export async function openAlexLab(
  name: string,
  university: string,
  today = new Date(),
): Promise<Lab | null> {
  const pick = await openAlexMatch(name, university);
  if (!pick) return null;
  const id = shortId(pick.id);
  const year = today.getFullYear();
  const since = year - 5;
  const works = parseWorks(
    await getJson(
      `${API}/works?filter=author.id:${id},from_publication_date:${since}-01-01&sort=publication_date:desc&per-page=100&select=${WORK_FIELDS}`,
    ),
  );
  const home = institutions(pick.last_known_institutions).map((i) => i.id);
  const frequent = coAuthors(id, home, works, year).slice(0, 25);
  const current = await whereNow(frequent.map((c) => c.id));
  return {
    name: text(pick.display_name),
    institution: lastInstitution(pick),
    works: works.length,
    since,
    coAuthors: coAuthors(id, home, works, year, current),
  };
}

/**
 * The applicant's co-authors across their papers, most papers first, without the professor.
 * With 2+ papers, the one author on every paper is the applicant and is left out.
 */
export function applicantCircle(papers: Work[], professorId: string) {
  const count = new Map<string, { id: string; name: string; papers: number }>();
  for (const w of papers)
    for (const a of w.authors) {
      if (!a.id || a.id === professorId) continue;
      const c = count.get(a.id) ?? { id: a.id, name: a.name, papers: 0 };
      c.papers++;
      count.set(a.id, c);
    }
  // ponytail: with one paper, or a co-author on every paper too, the applicant can't be told
  // apart and stays in; their own works with the professor then read as a path.
  const onAll = [...count.values()].filter((c) => c.papers === papers.length);
  const you = papers.length > 1 && onAll.length === 1 ? onAll[0]?.id : undefined;
  return [...count.values()].filter((c) => c.id !== you).toSorted((a, b) => b.papers - a.papers);
}

export type Warm = {
  name: string;
  /** The applicant's papers OpenAlex has, by title. */
  found: string[];
  /** Those the professor wrote too. */
  direct: Work[];
  /** Works a co-author of the applicant wrote with the professor. */
  paths: { via: string; title: string; year: number; link: string }[];
};

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * What links the applicant to a professor on OpenAlex. Each paper (a fact's text; its quoted
 * title when it has one) is searched by title and kept only when the fact holds that title; its
 * authors are the applicant's co-authors, and each co-author's works with the professor are warm
 * paths. At most 5 papers and 10 co-authors, a request each; a failed lookup adds nothing.
 */
export async function openAlexWarm(
  name: string,
  university: string,
  papers: string[],
): Promise<Warm | null> {
  const pick = await openAlexMatch(name, university);
  if (!pick) return null;
  const id = shortId(pick.id);
  const found = (
    await Promise.all(
      papers.slice(0, 5).map(async (paper) => {
        const title = /["“]([^"”]{12,})["”]/.exec(paper)?.[1] ?? paper;
        const body = await getJson(
          `${API}/works?search=${encodeURIComponent(title)}&per-page=1&select=${WORK_FIELDS}`,
        ).catch(() => null);
        return parseWorks(body).filter((w) => w.title && plain(paper).includes(plain(w.title)));
      }),
    )
  ).flat();
  const paths: Warm["paths"] = [];
  for (const c of applicantCircle(found, id).slice(0, 10)) {
    const body = await getJson(
      `${API}/works?filter=author.id:${c.id},author.id:${id}&sort=publication_date:desc&per-page=3&select=id,title,publication_year,doi`,
    ).catch(() => null);
    // A paper of the applicant's own that the professor is on shows as direct instead.
    for (const w of parseWorks(body))
      if (!found.some((f) => f.link === w.link))
        paths.push({ via: c.name, title: w.title, year: w.year, link: w.link });
  }
  return {
    name: text(pick.display_name),
    found: found.map((w) => w.title),
    direct: found.filter((w) => w.authors.some((a) => a.id === id)),
    paths,
  };
}
