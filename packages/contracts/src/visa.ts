// A country's lane for a non-EU doctoral researcher: Schengen or not, which permit, how long a
// graduate may stay to find work, and who must recognise a foreign Master's. Europe only; the
// rest reads null and the agent explains the lane itself. Stated as the pages read on
// 2026-10-11; the url is there to re-check before relying on one.
export type VisaLane = {
  schengen: boolean;
  /**
   * directive: the EU Researcher Directive 2016/801 hosting agreement replaces a work permit;
   * own: the country's own researcher or student permit; quota: Switzerland's third-country quota.
   */
  permit: "directive" | "own" | "quota";
  /** Months a graduate may stay to look for work; null when unknown. */
  stayAfterMonths: number | null;
  /** Who recognises a foreign Master's before admission, e.g. "anabin"; empty when no step is asked. */
  recognition: string;
  url: string;
};

const DIRECTIVE = "https://eur-lex.europa.eu/eli/dir/2016/801/oj/eng";
const directive = (over: Partial<VisaLane> = {}): VisaLane => ({
  schengen: true,
  permit: "directive",
  stayAfterMonths: 9,
  recognition: "",
  url: DIRECTIVE,
  ...over,
});

const LANES: Record<string, VisaLane> = {
  austria: directive({
    stayAfterMonths: 12,
    url: "https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/researchers/",
  }),
  belgium: directive({
    recognition: "NARIC-Vlaanderen for Flemish universities, or the French community's equivalence",
    url: "https://www.vlaanderen.be/en/naric-vlaanderen",
  }),
  bulgaria: directive(),
  croatia: directive(),
  cyprus: directive({ schengen: false }),
  czechia: directive(),
  "czech republic": directive(),
  denmark: directive({
    permit: "own",
    stayAfterMonths: 36,
    url: "https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Researcher",
  }),
  estonia: directive(),
  finland: directive({
    stayAfterMonths: 24,
    url: "https://migri.fi/en/residence-permit-application-for-researchers",
  }),
  france: directive({
    stayAfterMonths: 12,
    url: "https://www.campusfrance.org/en/residence-permit-passeport-talent-chercheur",
  }),
  germany: directive({
    stayAfterMonths: 18,
    recognition: "anabin",
    url: "https://www.make-it-in-germany.com/en/visa-residence/types/research",
  }),
  greece: directive(),
  hungary: directive(),
  iceland: {
    schengen: true,
    permit: "own",
    stayAfterMonths: 6,
    recognition: "",
    url: "https://island.is/en/residence-permit-for-students",
  },
  ireland: {
    schengen: false,
    permit: "own",
    stayAfterMonths: 24,
    recognition: "",
    url: "https://home-affairs.ec.europa.eu/policies/migration-and-asylum/eu-immigration-portal/researcher-ireland_en",
  },
  italy: directive({
    stayAfterMonths: 12,
    recognition: "a Dichiarazione di Valore or CIMEA statement for the Master's",
    url: "https://www.esteri.it/en/servizi-consolari-e-visti/",
  }),
  latvia: directive(),
  liechtenstein: {
    schengen: true,
    permit: "quota",
    stayAfterMonths: null,
    recognition: "",
    url: "https://www.llv.li/",
  },
  lithuania: directive(),
  luxembourg: directive({
    url: "https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/chercheur.html",
  }),
  malta: directive(),
  netherlands: directive({
    stayAfterMonths: 12,
    url: "https://ind.nl/en/residence-permits/work/residence-permit-researcher-directive-eu-2016801",
  }),
  norway: {
    schengen: true,
    permit: "own",
    stayAfterMonths: 12,
    recognition: "",
    url: "https://www.udi.no/en/want-to-apply/work-immigration/researchers-with-own-funds/",
  },
  poland: directive(),
  portugal: directive(),
  romania: directive(),
  slovakia: directive(),
  slovenia: directive(),
  spain: directive({ stayAfterMonths: 12, url: "https://extranjeros.inclusion.gob.es/" }),
  sweden: directive({
    stayAfterMonths: 12,
    url: "https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Researchers.html",
  }),
  switzerland: {
    schengen: true,
    permit: "quota",
    stayAfterMonths: 6,
    recognition: "",
    url: "https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige.html",
  },
};

/** The lane for a country as a program or school names it; null outside Europe. */
export function laneFor(country: string): VisaLane | null {
  const key = country.trim().toLowerCase();
  return LANES[key] ?? Object.entries(LANES).find(([k]) => key.includes(k))?.[1] ?? null;
}

/** One line for a program page: "Schengen · hosting agreement (directive 2016/801) · 9 months after". */
export function laneLine(lane: VisaLane) {
  const permit =
    lane.permit === "directive"
      ? "hosting agreement (directive 2016/801)"
      : lane.permit === "quota"
        ? "quota permit"
        : "own researcher permit";
  return [
    lane.schengen ? "Schengen" : "not Schengen",
    permit,
    lane.stayAfterMonths !== null ? `${lane.stayAfterMonths} months after to find work` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
