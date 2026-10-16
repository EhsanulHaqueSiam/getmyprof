// A country's lane for a doctoral student from abroad: Schengen, the EU or neither, which permit,
// how long a graduate may stay to find work, and who must recognise a foreign Master's. Keyed by
// ISO code, so "Ontario, Canada" and "Korea" find theirs. Stated as the pages read on 2026-10-11
// (Europe) and 2026-10-17 (elsewhere); the url is there to re-check before relying on one.
import { placeCountries } from "./places.ts";

export type VisaLane = {
  bloc: "schengen" | "eu" | "none";
  /** The permit a doctoral student holds and what it allows, in a few words. */
  permit: string;
  /** Months a graduate may stay to look for work: 0 when the permit ends with the degree, null when unknown. */
  stayAfterMonths: number | null;
  /** Who recognises a foreign Master's before admission, e.g. "anabin"; empty when no step is asked. */
  recognition: string;
  url: string;
};

const DIRECTIVE = "https://eur-lex.europa.eu/eli/dir/2016/801/oj/eng";
/** The EU Researcher Directive 2016/801: a hosting agreement replaces a work permit. */
const directive = (over: Partial<VisaLane> = {}): VisaLane => ({
  bloc: "schengen",
  permit: "hosting agreement (directive 2016/801)",
  stayAfterMonths: 9,
  recognition: "",
  url: DIRECTIVE,
  ...over,
});
const OWN = "own researcher permit";
const QUOTA = "quota permit for non-EU nationals";
/** A lane outside Europe; most say nothing of a stay after or a recognition step. */
const away = (permit: string, url: string, over: Partial<VisaLane> = {}): VisaLane => ({
  bloc: "none",
  permit,
  stayAfterMonths: null,
  recognition: "",
  url,
  ...over,
});

const LANES: Record<string, VisaLane> = {
  at: directive({
    stayAfterMonths: 12,
    url: "https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/researchers/",
  }),
  be: directive({
    recognition: "NARIC-Vlaanderen for Flemish universities, or the French community's equivalence",
    url: "https://www.vlaanderen.be/en/naric-vlaanderen",
  }),
  bg: directive(),
  hr: directive(),
  cy: directive({ bloc: "eu" }),
  cz: directive(),
  dk: directive({
    permit: OWN,
    stayAfterMonths: 36,
    url: "https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Researcher",
  }),
  ee: directive(),
  fi: directive({
    stayAfterMonths: 24,
    url: "https://migri.fi/en/residence-permit-application-for-researchers",
  }),
  fr: directive({
    stayAfterMonths: 12,
    url: "https://www.campusfrance.org/en/residence-permit-passeport-talent-chercheur",
  }),
  de: directive({
    stayAfterMonths: 18,
    recognition: "anabin",
    url: "https://www.make-it-in-germany.com/en/visa-residence/types/research",
  }),
  gr: directive(),
  hu: directive(),
  is: directive({
    permit: OWN,
    stayAfterMonths: 6,
    url: "https://island.is/en/residence-permit-for-students",
  }),
  ie: directive({
    bloc: "eu",
    permit: OWN,
    stayAfterMonths: 24,
    url: "https://home-affairs.ec.europa.eu/policies/migration-and-asylum/eu-immigration-portal/researcher-ireland_en",
  }),
  it: directive({
    stayAfterMonths: 12,
    recognition: "a Dichiarazione di Valore or CIMEA statement for the Master's",
    url: "https://www.esteri.it/en/servizi-consolari-e-visti/",
  }),
  lv: directive(),
  li: directive({ permit: QUOTA, stayAfterMonths: null, url: "https://www.llv.li/" }),
  lt: directive(),
  lu: directive({
    url: "https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/chercheur.html",
  }),
  mt: directive(),
  nl: directive({
    stayAfterMonths: 12,
    url: "https://ind.nl/en/residence-permits/work/residence-permit-researcher-directive-eu-2016801",
  }),
  no: directive({
    permit: OWN,
    stayAfterMonths: 12,
    url: "https://www.udi.no/en/want-to-apply/work-immigration/researchers-with-own-funds/",
  }),
  pl: directive(),
  pt: directive(),
  ro: directive(),
  sk: directive(),
  si: directive(),
  es: directive({ stayAfterMonths: 12, url: "https://extranjeros.inclusion.gob.es/" }),
  se: directive({
    stayAfterMonths: 12,
    url: "https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Researchers.html",
  }),
  ch: directive({
    permit: QUOTA,
    stayAfterMonths: 6,
    url: "https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige.html",
  }),
  gb: away("Student visa", "https://www.gov.uk/graduate-visa", { stayAfterMonths: 36 }),
  us: away(
    "F-1 or J-1 student visa; STEM OPT adds 24 months",
    "https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-extension-for-stem-students-stem-opt",
    { stayAfterMonths: 12 },
  ),
  ca: away(
    "study permit; doctoral students skip the intake cap and attestation letter, and get 14-day processing",
    "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/graduate-student.html",
    { stayAfterMonths: 36 },
  ),
  au: away(
    "student visa 500, for the course plus 8 months for research; the 485 graduate visa runs 2 to 3 years",
    "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500/length-of-stay",
    { stayAfterMonths: 24 },
  ),
  nz: away(
    "student visa; PhD students pay domestic fees, and a partner may get an open work visa",
    "https://www.auckland.ac.nz/en/study/fees-and-money-matters/tuition-fees/doctoral-fees.html",
    { stayAfterMonths: 36 },
  ),
  jp: away(
    "Student status, with permission to work 28 hours a week; J-Find allows 24 months after",
    "https://www.k.u-tokyo.ac.jp/en/international/student_support/job_hunting/",
    { stayAfterMonths: 12 },
  ),
  kr: away(
    "D-2 student visa, two years at a time",
    "https://www.studyinkorea.go.kr/en/plan/visaAndStay.do",
    {
      stayAfterMonths: 24,
    },
  ),
  hk: away(
    "student visa; IANG after needs no job offer within six months",
    "https://www.immd.gov.hk/eng/services/visas/IANG.html",
    { stayAfterMonths: 24 },
  ),
  mo: away(
    "stay permit through the University of Macau; 20 hours a week of research duties",
    "https://www.um.edu.mo/rskto/document.html",
    {
      recognition: "the University of Macau recognises the Master's",
    },
  ),
  tw: away(
    "resident visa; 20 hours a week of work",
    "https://english.moe.gov.tw/fp-96-25406-b2053-1.html",
    {
      stayAfterMonths: 12,
      recognition: "the Ministry of Education's list of recognised foreign universities",
    },
  ),
  sg: away(
    "Student's Pass; the 12-month pass after allows no work until a job's pass",
    "https://careerservices.smu.edu.sg/postgraduate/working-singapore-international-graduates",
    { stayAfterMonths: 12 },
  ),
  cn: away("X1 visa, then a residence permit; no work off campus", "https://www.visaforchina.cn", {
    recognition: "degrees notarised in your home country",
  }),
  my: away(
    "student pass through EMGS; work only with the university's approval",
    "https://visa.educationmalaysia.gov.my",
  ),
  th: away("Non-Immigrant ED visa", "https://www.mfa.go.th/", {
    recognition: "the Ministry of Higher Education (MHESI) recognises the Master's",
  }),
  id: away("limited stay permit (KITAS)", "https://klirensetik.brin.go.id/", {
    recognition: "a degree equivalency (penyetaraan ijazah)",
  }),
  in: away(
    "student or research visa",
    "https://www.jncasr.ac.in/admissions/international-students",
    {
      recognition: "the institute checks the degree's equivalence",
    },
  ),
  sa: away("student residence (iqama); no paid work", "https://studyinsaudi.sa/en/VisaOptions", {
    stayAfterMonths: 0,
    recognition: "certificates attested by your country's education and foreign ministries",
  }),
  ae: away(
    "student residence the university sponsors; part-time work with a permit",
    "https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas",
    { stayAfterMonths: 0, recognition: "the Ministry of Education's equivalency" },
  ),
  qa: away(
    "student residence the university sponsors; 20 hours a week of work",
    "https://www.hbku.edu.qa/en/scholarship",
  ),
  om: away("residency card", "https://www.squ.edu.om/ps/en-us/programs", {
    recognition: "the Ministry of Higher Education (MoHERI) equivalency",
  }),
  tr: away("student residence permit", "https://ytb.gov.tr/en/departments/international-students", {
    recognition: "YÖK recognition",
  }),
  il: away(
    "A2 student visa; staying on needs a B1 work visa",
    "https://studyisrael.org.il/planning/",
    {
      stayAfterMonths: 0,
    },
  ),
  mx: away(
    "temporary resident visa for students; scholarships expect a return home",
    "https://www.gob.mx/inm",
  ),
  br: away(
    "student visa; PEC-PG expects a return home",
    "https://www.gov.br/mre/en/subjects/culture-and-education/educational-themes/study-opportunities-for-international-applicants/pec-pg-graduate/selection-process-2",
  ),
  cl: away("temporary residence for study", "https://ayuda.anid.gob.cl/"),
  ar: away(
    "temporary residence for study",
    "https://www.argentina.gob.ar/educacion/campusargentinaglobal/becas-argentina/doctorales-cofinanciadas-conicet",
    { recognition: "a recognised foreign degree, and a CONEAU-accredited PhD programme" },
  ),
  za: away("study visa; 12 hours a week of work on NRF funding", "https://www.saqa.org.za/", {
    recognition: "SAQA's evaluation of foreign qualifications",
  }),
};

/** The lane for a country as a program or school names it ("Ontario, Canada"); null when unknown. */
export function laneFor(country: string): VisaLane | null {
  const [code] = placeCountries([country], false);
  return (code && LANES[code]) || null;
}

/** One line for a program page: "Schengen · hosting agreement (directive 2016/801) · 9 months after to find work". */
export function laneLine(lane: VisaLane) {
  return [
    lane.bloc === "schengen" ? "Schengen" : lane.bloc === "eu" ? "EU, not Schengen" : "",
    lane.permit,
    lane.stayAfterMonths === 0
      ? "the permit ends with the degree"
      : lane.stayAfterMonths !== null
        ? `${lane.stayAfterMonths} months after to find work`
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
