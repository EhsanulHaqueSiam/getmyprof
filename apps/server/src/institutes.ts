// Research institutes in Europe with their own funded doctoral programmes: no rank, their own
// portal, one or two application cycles a year, and often a partner university that grants the
// degree. All take non-EU applicants and pay by contract. Dates are the 2026 to 2027 cycle as
// each portal stated them on 2026-10-11; the source is there to re-check before relying on one.
export type Institute = {
  name: string;
  country: string;
  /** Words from the fields it trains in, lower case, matched against the hunt's fields. */
  fields: string[];
  /** The application cycle in one line, with the next dates. */
  cycle: string;
  /** Who grants the degree, when it is not the institute itself. */
  degree: string;
  /** The programme's own page. */
  url: string;
};

export const INSTITUTES: Institute[] = [
  {
    name: "EMBL International PhD Programme",
    country: "Germany",
    fields: ["biology", "bioinformatics", "computational biology", "structural", "genomics"],
    cycle: "Two rounds a year; the winter round closes 12 Oct 2026 for a 2027 start",
    degree: "Partner universities (Heidelberg and others) co-award the degree",
    url: "https://www.embl.org/about/info/embl-international-phd-programme/application/",
  },
  {
    name: "EMBL-EBI",
    country: "United Kingdom",
    fields: ["bioinformatics", "computational biology", "data science", "genomics"],
    cycle: "Through the EMBL International PhD Programme; the winter round closes 12 Oct 2026",
    degree: "University of Cambridge or a partner university",
    url: "https://www.ebi.ac.uk/research/eipp/",
  },
  {
    name: "IMPRS for Intelligent Systems (Max Planck)",
    country: "Germany",
    fields: ["machine learning", "robotics", "computer vision", "ai", "intelligent systems"],
    cycle: "One call a year; closes 15 Nov 2026 for a 2027 start",
    degree: "University of Tübingen or University of Stuttgart",
    url: "https://imprs.is.mpg.de/application",
  },
  {
    name: "Max Planck Research Schools (IMPRS)",
    country: "Germany",
    fields: ["physics", "chemistry", "biology", "neuroscience", "mathematics", "humanities"],
    cycle: "Each school sets its own deadlines, mostly Nov to Jan; many also hire year round",
    degree: "The school's partner university",
    url: "https://www.mpg.de/en/imprs",
  },
  {
    name: "Helmholtz graduate schools",
    country: "Germany",
    fields: ["physics", "energy", "earth", "health", "information", "materials", "aeronautics"],
    cycle: "Each centre recruits year round; positions are salaried, often 65% TV-L E13",
    degree: "The centre's partner university",
    url: "https://www.helmholtz.de/en/career/doctoral-researchers/",
  },
  {
    name: "ISTA (Institute of Science and Technology Austria)",
    country: "Austria",
    fields: ["computer science", "mathematics", "physics", "biology", "neuroscience", "chemistry"],
    cycle: "One call a year; opens late Oct 2026, closes 8 Jan 2027 for a Sep 2027 start",
    degree: "ISTA grants its own PhD",
    url: "https://phd.pages.ista.ac.at/phd-application-admission/",
  },
  {
    name: "CERN Doctoral Student Programme",
    country: "Switzerland",
    fields: ["physics", "particle", "accelerator", "engineering", "computing", "electronics"],
    cycle: "Two selection rounds a year (spring and autumn); the thesis is at the home university",
    degree: "The student's own university; CERN hosts and pays",
    url: "https://careers.cern/doctoral-student-programme",
  },
  {
    name: "ETH Zurich doctoral studies",
    country: "Switzerland",
    fields: ["engineering", "computer science", "physics", "chemistry", "biology", "mathematics"],
    cycle:
      "Positions year round, each advertised by its professor; CHF 50k to 55k on an SNSF grant",
    degree: "ETH Zurich",
    url: "https://ethz.ch/en/doctorate.html",
  },
  {
    name: "EPFL doctoral school (EDOC)",
    country: "Switzerland",
    fields: ["engineering", "computer science", "physics", "life sciences", "mathematics"],
    cycle: "Programme deadlines in Jan, Apr and Sep; EDIC closes 15 Dec and 15 Apr",
    degree: "EPFL",
    url: "https://www.epfl.ch/education/phd/",
  },
  {
    name: "CNRS doctoral contracts",
    country: "France",
    fields: ["physics", "chemistry", "biology", "computer science", "humanities", "earth"],
    cycle: "Positions year round on emploi.cnrs.fr; most doctoral school contracts open Mar to Jun",
    degree: "The host university's doctoral school",
    url: "https://emploi.cnrs.fr/",
  },
  {
    name: "CSIC (Spanish National Research Council)",
    country: "Spain",
    fields: ["physics", "chemistry", "biology", "materials", "humanities", "agriculture"],
    cycle: "FPI contracts attach to a PI's PID project; the ministry call opens in autumn",
    degree: "A partner university",
    url: "https://www.csic.es/en/training-and-employment",
  },
  {
    name: "ESO Studentship Programme",
    country: "Germany",
    fields: ["astronomy", "astrophysics"],
    cycle: "Two rounds a year, closing 15 May and 15 Nov; one to two years hosted at ESO",
    degree: "The student's home university",
    url: "https://www.eso.org/sci/activities/FeV/studentship.html",
  },
  {
    name: "ESA (European Space Agency) research fellowships",
    country: "Netherlands",
    fields: ["space", "aerospace", "earth observation", "physics", "engineering"],
    cycle:
      "PhD co-funding through national agencies and the Open Space Innovation Platform; rolling",
    degree: "The student's home university",
    url: "https://www.esa.int/About_Us/Careers_at_ESA/Research_Fellowships",
  },
  {
    name: "IIASA Young Scientists Summer Program",
    country: "Austria",
    fields: ["systems", "energy", "climate", "economics", "population", "ecology"],
    cycle: "Three summer months for enrolled PhD students; applications close mid Jan",
    degree: "The student's home university",
    url: "https://iiasa.ac.at/early-career/yssp",
  },
  {
    name: "Wellcome Sanger Institute PhD",
    country: "United Kingdom",
    fields: ["genomics", "bioinformatics", "biology", "computational biology"],
    cycle: "One call a year; closes early Dec for a Sep start",
    degree: "University of Cambridge",
    url: "https://www.sanger.ac.uk/about/study/",
  },
];

/** Institutes whose fields name any word of the hunt's fields; all of them when none match. */
export function institutesFor(fields: string[]): Institute[] {
  const words = fields.flatMap((f) => f.toLowerCase().split(/\W+/)).filter((w) => w.length > 2);
  const hit = INSTITUTES.filter((i) =>
    i.fields.some((f) => words.some((w) => f.includes(w) || w.includes(f))),
  );
  return hit.length ? hit : INSTITUTES;
}
