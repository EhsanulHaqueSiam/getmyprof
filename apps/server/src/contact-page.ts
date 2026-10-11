// What a professor's own page says about prospective students, quoted and dated: whether they are
// taking students (and from when), words the subject line must carry, a form to use instead of
// email, "don't email me", "apply to the program first" and whether they want a CV. The agent
// reads it through read_contact_rule (agent/people-tools.ts) and records it with
// propose_professor; the draft checks then hold the student to it.

const TIMEOUT_MS = 20_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) getmyprof";

/** One reading of a professor's pages. Each rule is their sentence, or null when unsaid. */
export type ContactRead = {
  /** The pages read, the homepage first. */
  urls: string[];
  /** ISO date of the reading. */
  readOn: string;
  /** Their sentences about taking students, at most three. */
  statements: string[];
  /** "no" when a statement says they aren't taking, "yes" when one says they are. */
  taking: "yes" | "no" | null;
  /** The words they want in the subject line, e.g. "PhD 2027". */
  subject: string | null;
  /** A form or portal they want used instead of email. */
  form: string | null;
  noEmail: string | null;
  applyFirst: string | null;
  cv: string | null;
  /** Addresses the pages give, so the agent needn't look for one elsewhere. */
  emails: string[];
  /** The page each quoted sentence is on, so a quote cites where it really is. */
  from: Record<string, string>;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  "#39": "'",
  "#x27": "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  ldquo: "“",
  rdquo: "”",
};

/** Page text as sentences: block tags break lines, scripts and styles drop out. */
export function sentences(html: string): string[] {
  const body = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|li|h[1-6]|br|tr|section|article|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&(amp|quot|#39|#x27|nbsp|rsquo|lsquo|ldquo|rdquo);/g,
      (_, e: string) => ENTITIES[e] ?? " ",
    );
  return (
    body
      .split(/\n|(?<=[.!?])\s+(?=[A-Z"“(])/)
      // Bullets and bold marks ("** I plan to recruit...") aren't their words.
      .map((s) =>
        s
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^[*\-•·#>\s]+/, ""),
      )
      .filter((s) => s.length > 8 && s.length < 400)
  );
}

const STUDENTS = /\b(students?|ph\.?\s?d|doctoral|graduate|applicants?|positions?|openings?)\b/i;
const RECRUITING =
  /\b(recruit(?:ing|s)?|accept(?:ing|s)?|admit(?:ting)?|taking|looking for|hiring|openings?|positions? (?:is|are) available|join (?:my|our|the) (?:lab|group))\b/i;
const NOT_TAKING =
  /\b(not|no longer|n[o']t)\s+(?:currently\s+|be\s+|actively\s+)?(?:taking|accepting|recruiting|looking for|hiring|admitting)\b|\bno (?:open )?(?:positions|openings|funding)\b|\b(?:lab|group) is (?:currently )?full\b/i;
// Their words for the subject line, quoted after "subject" or before it.
const SUBJECT = [
  /subject(?: line)?\b[^.]{0,60}?["“'[]([^"”'\]]{2,40})["”'\]]/i,
  /["“'[]([^"”'\]]{2,40})["”'\]][^.]{0,40}?\bsubject\b/i,
];
const NO_EMAIL =
  /\b(?:do not|don't|please don't|please do not|kindly do not)\s+(?:e-?mail|contact|write to)\b|\b(?:can ?not|cannot|unable to|will not|won't|do not)\s+(?:reply|respond|answer)\b[^.]{0,30}\be-?mails?\b/i;
const APPLY_FIRST =
  /\b(?:apply|submit an application)\b[^.]{0,40}\b(?:first|before (?:contacting|emailing|reaching out))\b|\b(?:first|must|should|please)\s+apply\b[^.]{0,60}\b(?:program|department|school|admissions?)\b|\bapply (?:directly )?(?:to|through) (?:the|our) (?:\w+ ){0,3}(?:program|department|admissions?)\b[^.]{0,60}\b(?:mention|list|name|indicate)\b/i;
const CV =
  /\b(?:attach|include|send|enclose)\b[^.]{0,40}\b(?:cv|c\.v\.|resume|résumé|transcripts?)\b/i;
const FORM_HOST =
  /^https?:\/\/(?:forms\.gle|docs\.google\.com\/forms|forms\.office\.com|[\w-]+\.typeform\.com|airtable\.com|[\w.-]*jotform\.com|[\w.-]*qualtrics\.com)\//i;

/** The links on a page, absolute, with their text. */
export function links(html: string, base: string) {
  return [...html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)].flatMap(
    ([, href, inner]) => {
      try {
        return [
          {
            url: new URL(href ?? "", base).toString(),
            text: (inner ?? "").replace(/<[^>]+>/g, " ").trim(),
          },
        ];
      } catch {
        return [];
      }
    },
  );
}

/** The page on the same site a homepage points prospective students to, if it links one. */
export function prospectivePage(html: string, base: string): string | null {
  const host = new URL(base).host;
  const hit = links(html, base).find(
    (l) =>
      new URL(l.url).host === host &&
      l.url !== base &&
      /prospective|join|opening|vacanc|positions|for students|apply/i.test(`${l.text} ${l.url}`),
  );
  return hit?.url ?? null;
}

/** Addresses a page gives: mailto links and spelled-out ones ("ada [at] cs [dot] edu"). */
export function emailsIn(html: string): string[] {
  const plain = html
    .replace(/&#0*64;|&#x40;/gi, "@")
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*dot\s*[\])}]\s*/gi, ".");
  const found = plain.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))]
    .filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e))
    .slice(0, 5);
}

/** Reads the rules out of one or more pages' HTML (pure; contactPage adds the fetching). */
export function readContactRule(pages: { url: string; html: string }[], today: Date): ContactRead {
  const read = pages.flatMap((p) => sentences(p.html).map((s) => ({ s, url: p.url })));
  const all = read.map((x) => x.s);
  const first = (re: RegExp) => all.find((s) => re.test(s)) ?? null;
  // A sentence, not a heading ("Prospective students" alone says nothing). A contact rule ("please
  // do not email me") is noEmail, not a yes; a no counts even inside one.
  const statements = [
    ...new Set(
      all.filter(
        (s) =>
          s.split(" ").length >= 5 &&
          STUDENTS.test(s) &&
          (NOT_TAKING.test(s) || (RECRUITING.test(s) && !NO_EMAIL.test(s) && !APPLY_FIRST.test(s))),
      ),
    ),
  ].slice(0, 3);
  const form =
    pages.flatMap((p) => links(p.html, p.url)).find((l) => FORM_HOST.test(l.url))?.url ?? null;
  const noEmail = first(NO_EMAIL);
  const applyFirst = first(APPLY_FIRST);
  const cv = first(CV);
  const quoted = [...statements, noEmail, applyFirst, cv].filter((q) => q !== null);
  return {
    urls: pages.map((p) => p.url),
    readOn: today.toISOString().slice(0, 10),
    statements,
    taking: statements.some((s) => NOT_TAKING.test(s)) ? "no" : statements.length ? "yes" : null,
    subject:
      all.flatMap((s) => SUBJECT.map((re) => re.exec(s)?.[1]?.trim() ?? "")).find(Boolean) ?? null,
    form,
    noEmail,
    applyFirst,
    cv,
    emails: [...new Set(pages.flatMap((p) => emailsIn(p.html)))].slice(0, 5),
    from: Object.fromEntries(quoted.map((q) => [q, read.find((x) => x.s === q)?.url ?? ""])),
  };
}

async function getHtml(url: string) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 410)
    throw new Error(`${url} is gone (${res.status}); find their current page with web_search`);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

/**
 * Reads a professor's page, and the prospective-students page it links to, if any. A page this
 * server can't load, or one built by JavaScript (almost no text), is read through `render`
 * (treg's free fetch) instead; 33 of 39 GMU pages Node couldn't load read that way.
 */
export async function contactPage(
  url: string,
  render: (url: string) => Promise<string | null> = async () => null,
): Promise<ContactRead> {
  const fetched = await getHtml(url).catch(async (error: unknown) => {
    const page = await render(url);
    if (page === null) throw error;
    return page;
  });
  const html = sentences(fetched).length < 3 ? ((await render(url)) ?? fetched) : fetched;
  const next = prospectivePage(html, url);
  const more = next ? await getHtml(next).catch(() => null) : null;
  return readContactRule(
    [{ url, html }, ...(next && more ? [{ url: next, html: more }] : [])],
    new Date(),
  );
}
