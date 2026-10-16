// Application windows Europe runs on a calendar of its own: a country's one bando season or
// scholarship round, dated for the hunt's intake. Next moves and the Calendar read them so a
// Fall 2027 hunt sees Italy's calls in May 2027, not December 2026. Stated as the pages read
// on 2026-10-11 (Eiffel on 2026-10-17); the url is there to re-check before relying on one.
export type Window = {
  /** The word in the hunt's places that turns it on, lower case. */
  country: string;
  title: string;
  detail: string;
  /** MM-DD it closes. */
  closes: string;
  /** How many years before the intake's year it closes: 0 for the same year, 1 for the year before. */
  yearsBefore: 0 | 1;
  url: string;
};

export const WINDOWS: Window[] = [
  {
    country: "italy",
    title: "Italian bandi: doctorate calls close",
    detail:
      "Each university publishes its bando around May and closes in early June for an October or November start. Shortlist universities before May; the calls are on bandi.mur.gov.it.",
    closes: "06-10",
    yearsBefore: 0,
    url: "https://bandi.mur.gov.it/doctorate.php/public/cercaFellowship",
  },
  {
    country: "germany",
    title: "DAAD doctoral scholarship closes",
    detail: "DAAD's research grant for a full doctorate closes 30 October for the next year.",
    closes: "10-30",
    yearsBefore: 1,
    url: "https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/?detail=57135739",
  },
  {
    country: "spain",
    title: "Spanish FPI contracts: the PID call closes",
    detail:
      "FPI predoctoral contracts attach to a PI's PID project; the ministry's call runs in the autumn before the start, and the university hires afterwards.",
    closes: "11-15",
    yearsBefore: 1,
    url: "https://www.aei.gob.es/en/grants-young-researchers",
  },
  {
    country: "switzerland",
    title: "Swiss Government Excellence Scholarship closes",
    detail:
      "Deadlines are set per country by the Swiss embassy, in the autumn before the start; ask the embassy for the date.",
    closes: "11-01",
    yearsBefore: 1,
    url: "https://www.sbfi.admin.ch/en/swiss-government-excellence-scholarships",
  },
  {
    country: "france",
    title: "Eiffel Excellence Scholarship: the host's call closes",
    detail:
      "You cannot apply yourself: the French host nominates you to Campus France in January, and hosts close their own call before that (Université Paris Cité: 2 November). Ask your host for its date in October.",
    closes: "11-02",
    yearsBefore: 1,
    url: "https://www.campusfrance.org/en/eiffel-scholarship-program-of-excellence",
  },
];

/** The year in "Fall 2027"; null without one. */
const intakeYear = (intake: string) => Number(/\b(20\d\d)\b/.exec(intake)?.[1]) || null;

/** The windows the hunt's places turn on, each dated for the intake; none without an intake year. */
export function windowsFor(places: string[], intake: string) {
  const year = intakeYear(intake);
  if (!year) return [];
  const where = places.join(" ").toLowerCase();
  return WINDOWS.filter((w) => new RegExp(`\\b${w.country}\\b`).test(where)).map((w) => ({
    ...w,
    date: `${year - w.yearsBefore}-${w.closes}`,
  }));
}
