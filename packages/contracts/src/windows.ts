// Application windows a country runs on its own calendar: a bando season, a national scholarship
// round, a fellowship call, dated for the hunt's intake. Next moves and the Calendar read them so a
// Fall 2027 hunt sees Italy's calls in May 2027, not December 2026. Where an embassy runs the call
// (MEXT, GKS, CSC, Taiwan, Swiss Excellence) the date is its usual close and the detail says the
// embassy sets the real one. Stated as the pages read on 2026-10-11 (Europe) and 2026-10-17 (the
// rest); the url is there to re-check before relying on one.
import { placeCountries } from "./places.ts";

export type Window = {
  /** The ISO code of the country whose places turn it on. */
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
    country: "it",
    title: "Italian bandi: doctorate calls close",
    detail:
      "Each university publishes its bando around May and closes in early June for an October or November start. Shortlist universities before May; the calls are on bandi.mur.gov.it.",
    closes: "06-10",
    yearsBefore: 0,
    url: "https://bandi.mur.gov.it/doctorate.php/public/cercaFellowship",
  },
  {
    country: "de",
    title: "DAAD doctoral scholarship closes",
    detail: "DAAD's research grant for a full doctorate closes 30 October for the next year.",
    closes: "10-30",
    yearsBefore: 1,
    url: "https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/?detail=57135739",
  },
  {
    country: "es",
    title: "Spanish FPI contracts: the PID call closes",
    detail:
      "FPI predoctoral contracts attach to a PI's PID project; the ministry's call runs in the autumn before the start, and the university hires afterwards.",
    closes: "11-15",
    yearsBefore: 1,
    url: "https://www.aei.gob.es/en/grants-young-researchers",
  },
  {
    country: "ch",
    title: "Swiss Government Excellence Scholarship closes",
    detail:
      "Deadlines are set per country by the Swiss embassy, in the autumn before the start; ask the embassy for the date.",
    closes: "11-01",
    yearsBefore: 1,
    url: "https://www.sbfi.admin.ch/en/swiss-government-excellence-scholarships",
  },
  {
    country: "fr",
    title: "Eiffel Excellence Scholarship: the host's call closes",
    detail:
      "You cannot apply yourself: the French host nominates you to Campus France in January, and hosts close their own call before that (Université Paris Cité: 2 November). Ask your host for its date in October.",
    closes: "11-02",
    yearsBefore: 1,
    url: "https://www.campusfrance.org/en/eiffel-scholarship-program-of-excellence",
  },
  {
    country: "hk",
    title: "Hong Kong PhD Fellowship closes",
    detail:
      "Apply to the Research Grants Council's HKPFS while you apply to a Hong Kong university: HK$344,400 a year for three years.",
    closes: "12-01",
    yearsBefore: 1,
    url: "https://www.ugc.edu.hk/eng/rgc/funding_opport/hkpfs/",
  },
  {
    country: "sg",
    title: "NTU President's Graduate Scholarship closes",
    detail:
      "It comes with admission to an NTU PhD, so apply by the end of December: S$4,300 a month for international students.",
    closes: "12-31",
    yearsBefore: 1,
    url: "https://www.ntu.edu.sg/admissions/graduate/financialmatters/scholarships/npgs",
  },
  {
    country: "mo",
    title: "University of Macau PhD scholarship: the funding round closes",
    detail:
      "Apply for admission with the scholarship; the first admission batch closes in late October. MOP 20,000 a month.",
    closes: "01-08",
    yearsBefore: 0,
    url: "https://grs.um.edu.mo/index.php/prospective-students/phd-funding/um-phd-scholarship/",
  },
  {
    country: "jp",
    title: "MEXT scholarship, embassy route: applications close",
    detail:
      "The Japanese embassy in your country sets the date and runs an exam; calls open around April the year before. Ask the embassy. Tuition, flights and ¥145,000 a month or more.",
    closes: "05-31",
    yearsBefore: 1,
    url: "https://www.studyinjapan.go.jp/en/smap-stopj-applications-research.html",
  },
  {
    country: "kr",
    title: "Global Korea Scholarship, embassy track: applications close",
    detail:
      "The Korean embassy in your country sets the date, usually in February or March for a September start. Ask the embassy. Tuition and a monthly allowance.",
    closes: "02-28",
    yearsBefore: 0,
    url: "https://www.studyinkorea.go.kr",
  },
  {
    country: "cn",
    title: "Chinese Government Scholarship (Type A) closes",
    detail:
      "Apply through the Chinese embassy in your country, which sets the date, usually in January; Type B goes through each university until about April. CNY 3,500 a month for a doctorate.",
    closes: "01-10",
    yearsBefore: 0,
    url: "http://www.campuschina.org",
  },
  {
    country: "tw",
    title: "Taiwan Scholarships (MOE and MOFA) close",
    detail:
      "Apply through the Taipei office in your country, which sets the date; 31 March is the usual close for an autumn start. NTD 20,000 to 30,000 a month.",
    closes: "03-31",
    yearsBefore: 0,
    url: "https://taiwanscholarship.moe.gov.tw/web/pages.aspx?p=7",
  },
  {
    country: "gb",
    title: "Commonwealth PhD Scholarships close",
    detail:
      "For citizens of the least developed and most vulnerable Commonwealth countries: tuition, a stipend and flights.",
    closes: "10-20",
    yearsBefore: 1,
    url: "https://cscuk.fcdo.gov.uk/scholarships/commonwealth-phd-scholarships-for-least-developed-countries-and-vulnerable-states/",
  },
  {
    country: "au",
    title: "Australia Awards close",
    detail:
      "For citizens of listed countries, for study starting early the next year: tuition, living costs and flights.",
    closes: "04-30",
    yearsBefore: 0,
    url: "https://www.dfat.gov.au/people-to-people/australia-awards/australia-awards-scholarships-opening-and-closing-dates",
  },
  {
    country: "au",
    title: "Australian universities' international scholarship rounds",
    detail:
      "Research Training Program scholarships (A$36,000 to 44,000 a year) for a start early the next year: Macquarie closes 31 July, Sydney 11 September. Each university runs its own round.",
    closes: "07-31",
    yearsBefore: 0,
    url: "https://www.mq.edu.au/research/phd-and-research-degrees/how-to-apply/scholarship-opportunities/scholarship-search/international-scholarship-round",
  },
  {
    country: "tr",
    title: "Türkiye Bursları closes",
    detail: "Apply online from 10 January: tuition, housing, health cover and a monthly stipend.",
    closes: "02-20",
    yearsBefore: 0,
    url: "https://turkiyeburslari.gov.tr/en/announcement/turkiye-scholarships-2026/2027-applications",
  },
  {
    country: "hu",
    title: "Stipendium Hungaricum closes",
    detail:
      "For citizens of partner countries: tuition, housing and HUF 140,000 to 180,000 a month, which is not enough alone.",
    closes: "01-15",
    yearsBefore: 0,
    url: "https://stipendiumhungaricum.hu",
  },
  {
    country: "cz",
    title: "Czech Government Scholarships close",
    detail:
      "For citizens of listed developing countries: CZK 17,000 a month for a doctorate starting the next September.",
    closes: "09-30",
    yearsBefore: 1,
    url: "https://msmt.gov.cz/eu-and-international-affairs/government-scholarships-developing-countries",
  },
  {
    country: "ro",
    title: "Romanian Government (MFA) scholarships close",
    detail: "Tuition, housing and a small monthly allowance for a doctorate in Romania.",
    closes: "03-31",
    yearsBefore: 0,
    url: "https://studyinromania.gov.ro/mfa_2026-2027",
  },
  {
    country: "lv",
    title: "Latvian state scholarships close",
    detail: "For citizens of listed countries: €700 a month, which only partly funds a PhD.",
    closes: "04-01",
    yearsBefore: 0,
    url: "https://www.viaa.gov.lv/en/latvian-state-scholarships",
  },
  {
    country: "be",
    title: "FWO PhD fellowship closes",
    detail:
      "Flanders: apply with a promoter at a Flemish university; about €2,700 a month for four years.",
    closes: "03-01",
    yearsBefore: 0,
    url: "https://www.fwo.be/en/support-programmes/all-calls/phd/phd-fellowship-fundamental-research/",
  },
  {
    country: "be",
    title: "Ghent University BOF scholarship for the Global South closes",
    detail:
      "You, a Ghent promoter and a promoter at home apply together: 24 months of a doctoral scholarship.",
    closes: "02-09",
    yearsBefore: 0,
    url: "https://www.ugent.be/en/research/funding/bof/dos",
  },
  {
    country: "pt",
    title: "FCT PhD studentships close",
    detail:
      "Apply with a host institution in Portugal: tuition, insurance and a monthly allowance for up to four years.",
    closes: "03-31",
    yearsBefore: 0,
    url: "https://www.fct.pt/en/concursos/concurso-bolsas-de-doutoramento-2026-linha-de-candidatura-geral/",
  },
  {
    country: "lu",
    title: "FNR AFdoc: the host's autumn call closes",
    detail:
      "The host institution applies for an AFdoc on your project, in calls ending late November and late April: a salary up to €54,574 a year.",
    closes: "11-30",
    yearsBefore: 1,
    url: "https://www.fnr.lu/funding-instruments/afdoc/",
  },
  {
    country: "lu",
    title: "FNR AFdoc: the host's spring call closes",
    detail:
      "The host institution applies for an AFdoc on your project: a salary up to €54,574 a year.",
    closes: "04-30",
    yearsBefore: 0,
    url: "https://www.fnr.lu/funding-instruments/afdoc/",
  },
  {
    country: "om",
    title: "Sultan Qaboos University admission closes",
    detail:
      "An international PhD admit is considered for its scholarship automatically: tuition waived and OMR 350 a month.",
    closes: "02-01",
    yearsBefore: 0,
    url: "https://www.squ.edu.om/ps/en-us/Scholarships",
  },
  {
    country: "ma",
    title: "UM6P PhD programme closes",
    detail: "Morocco's UM6P funds its doctoral students with a three-year scholarship.",
    closes: "04-07",
    yearsBefore: 0,
    url: "https://admission.fgses-um6p.ma",
  },
];

/** The year in "Fall 2027"; null without one. */
const intakeYear = (intake: string) => Number(/\b(20\d\d)\b/.exec(intake)?.[1]) || null;

/** The windows the hunt's places turn on, each dated for the intake; none without an intake year. */
export function windowsFor(places: string[], intake: string) {
  const year = intakeYear(intake);
  if (!year) return [];
  const codes = placeCountries(places);
  return WINDOWS.filter((w) => codes.includes(w.country)).map((w) => ({
    ...w,
    date: `${year - w.yearsBefore}-${w.closes}`,
  }));
}
