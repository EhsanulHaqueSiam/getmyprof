// How each country funds a PhD for a student from abroad, keyed by ISO code. The prompt reads a
// hunt's countries from it, so the agent chases a scholarship where one comes first and stops
// hunting grants where admission brings the money; Next moves, setup and Chances show the same
// line. Stated as the pages read on 2026-10-17; re-check a number before relying on it.
export type Country = {
  /** ISO 3166 code, lower case: OpenAlex filters awards by it. */
  code: string;
  name: string;
  /** Other words a hunt's places use for it, lower case. */
  aliases?: string[];
  /** One line: how a foreigner gets funded there, and when. */
  how: string;
};

export const COUNTRIES: Country[] = [
  {
    code: "us",
    name: "United States",
    aliases: ["usa", "us", "america", "united states of america", "new mexico", "new england"],
    how: "Funding comes with admission: the department pays a stipend and tuition through an RA or TA. Apply by the December to January deadlines and name the professors you want.",
  },
  {
    code: "gb",
    name: "United Kingdom",
    aliases: ["uk", "england", "scotland", "wales", "britain", "great britain", "northern ireland"],
    how: "Advertised studentships: a funded project with a named supervisor, or a doctoral training centre that funds its cohort. Most close December to February.",
  },
  {
    code: "ie",
    name: "Ireland",
    how: "Per-project positions a PI or research centre advertises with a stipend. No national scholarship for individuals since the Government of Ireland programme closed.",
  },
  {
    code: "ca",
    name: "Canada",
    how: "Funding comes with admission: departments guarantee a package (about C$29k to 47k a year). Apply November to January; many programs want a supervisor to agree first.",
  },
  {
    code: "au",
    name: "Australia",
    aliases: ["new south wales"],
    how: "A supervisor's support, then a Research Training Program scholarship (A$36k to 44k a year) each university awards in rounds from July to September.",
  },
  {
    code: "nz",
    name: "New Zealand",
    how: "University doctoral scholarships (NZ$32k to 35.5k a year), and international PhD students pay domestic fees. Contact a supervisor first; rounds run November to May.",
  },
  {
    code: "de",
    name: "Germany",
    how: "A salaried position on a professor's grant (ask even when none is posted), a graduate school, or a DAAD scholarship that closes 30 October the year before.",
  },
  {
    code: "nl",
    name: "Netherlands",
    aliases: ["holland"],
    how: "Salaried positions only (about €3,200 to €4,050 a month), each advertised on AcademicTransfer or the university's site. No scholarship to chase.",
  },
  {
    code: "se",
    name: "Sweden",
    how: "Salaried positions only, each advertised by the university. No PhD scholarship: the Swedish Institute funds master's only.",
  },
  {
    code: "no",
    name: "Norway",
    how: "Salaried positions only (about NOK 570k a year), advertised on Jobbnorge in rounds around September and January. No scholarship to chase.",
  },
  {
    code: "dk",
    name: "Denmark",
    how: "Salaried positions only (about DKK 32,500 a month), advertised by each university, often August to September. No scholarship to chase.",
  },
  {
    code: "fi",
    name: "Finland",
    how: "Salaried positions advertised by universities and the doctoral pilot programmes, often in rounds August to September. No scholarship to chase.",
  },
  {
    code: "ch",
    name: "Switzerland",
    how: "A salaried position (from about CHF 47k a year) on a professor's grant. The Swiss Government Excellence Scholarship goes through the Swiss embassy each autumn.",
  },
  {
    code: "at",
    name: "Austria",
    how: "A salaried position (about €2,830 a month, paid 14 times) on an FWF project or doctoral programme, advertised by the university.",
  },
  {
    code: "lu",
    name: "Luxembourg",
    how: "A salaried position (€44k to €55k a year) at the university or an institute, many funded by FNR's AFdoc calls ending April and November.",
  },
  {
    code: "be",
    name: "Belgium",
    how: "A position on a professor's project, or a fellowship you apply for with a promoter: FWO in Flanders (closes 1 March), FNRS in Wallonia.",
  },
  {
    code: "ee",
    name: "Estonia",
    how: "A salaried junior research fellow post (about €2,100 a month), applied for through each university's doctoral call.",
  },
  {
    code: "fr",
    name: "France",
    how: "A doctoral contract (at least €2,300 gross a month) on an advertised thesis topic, or an Eiffel scholarship your host nominates you for. The master's must be recognised.",
  },
  {
    code: "it",
    name: "Italy",
    how: "One bando per university each spring (May to July) with funded places at €16k to €27k a year. MAECI is a nine-month top-up once admitted, not a PhD.",
  },
  {
    code: "es",
    name: "Spain",
    how: "An FPI contract on a PI's project (called in the autumn) or an FPU contract (first half of the year), €19k to €25k a year. Spanish helps.",
  },
  {
    code: "pt",
    name: "Portugal",
    how: "An FCT studentship you apply for with a host (the regular call closes around March), or a project position.",
  },
  {
    code: "pl",
    name: "Poland",
    how: "A position on an NCN project (PLN 5,000 to 8,500 a month), advertised on the ministry's board. No national scholarship for most foreigners.",
  },
  {
    code: "cz",
    name: "Czechia",
    aliases: ["czech republic"],
    how: "A doctoral stipend (about CZK 27,000 a month) plus project top-ups; government scholarships for listed developing countries close 30 September. The degree needs nostrification.",
  },
  {
    code: "sk",
    name: "Slovakia",
    how: "A state stipend (€1,175 to €1,368 a month) that comes with admission.",
  },
  {
    code: "hu",
    name: "Hungary",
    how: "Stipendium Hungaricum, a scholarship you win first (closes mid January; HUF 140k to 180k a month, not enough alone), or a project post.",
  },
  {
    code: "ro",
    name: "Romania",
    how: "A state doctoral grant, or a Ministry of Foreign Affairs scholarship (closes around 31 March); stipends are small.",
  },
  {
    code: "bg",
    name: "Bulgaria",
    how: "A contract on a funded project (€1,650 to €2,500 a month), per competition; INSAIT pays well.",
  },
  {
    code: "gr",
    name: "Greece",
    how: "MSCA and project posts, or an IKY doctoral scholarship (opens in January).",
  },
  {
    code: "cy",
    name: "Cyprus",
    how: "Thin: assistantships of €342 to €683 a month, or an MSCA post.",
  },
  {
    code: "mt",
    name: "Malta",
    how: "A post on a funded project (about €30k a year) or a fee waiver, May to September.",
  },
  {
    code: "si",
    name: "Slovenia",
    how: "A Young Researcher post (salaried for four years) on an ARIS-funded programme, or an Ad futura scholarship around July.",
  },
  {
    code: "hr",
    name: "Croatia",
    how: "A post on an HRZZ project, or a bilateral scholarship that closes around 10 April the year before.",
  },
  {
    code: "lv",
    name: "Latvia",
    how: "State-funded doctoral employment (€1,000 to €1,300 a month); the state scholarship (1 April) is partial.",
  },
  {
    code: "lt",
    name: "Lithuania",
    how: "A state-funded doctoral place with a stipend (€741 to €1,628 a month), admitted in June.",
  },
  {
    code: "is",
    name: "Iceland",
    how: "The IRF doctoral grant with a supervisor (ISK 525k a month, closes 15 June), or a project post.",
  },
  {
    code: "rs",
    name: "Serbia",
    how: "A ministry scholarship after enrolment, or World in Serbia for nominated countries.",
  },
  {
    code: "tr",
    name: "Turkey",
    aliases: ["turkiye"],
    how: "Türkiye Bursları, a scholarship you win first (closes 20 February; full, TL 6,500 a month), or a TÜBİTAK project post.",
  },
  {
    code: "il",
    name: "Israel",
    how: "A university fellowship after admission, on a supervisor's grant. Check what your passport allows before applying.",
  },
  {
    code: "ru",
    name: "Russia",
    how: "Government quota places (apply by mid January) pay RUB 4,000 to 9,000 a month, far below living costs; sanctions block most payments.",
  },
  {
    code: "sa",
    name: "Saudi Arabia",
    how: "A full scholarship with admission (KAUST pays about $20k to $30k a year); apply January to March.",
  },
  {
    code: "ae",
    name: "United Arab Emirates",
    aliases: ["uae", "emirates"],
    how: "A package with admission (Khalifa, UAEU, MBZUAI), set by each university.",
  },
  {
    code: "qa",
    name: "Qatar",
    how: "HBKU pays about QAR 9,000 a month with research duties; QNRF's GSRA opens in May.",
  },
  {
    code: "om",
    name: "Oman",
    how: "A Sultan Qaboos University scholarship with admission (OMR 350 a month); apply by 1 February.",
  },
  {
    code: "kz",
    name: "Kazakhstan",
    how: "A government grant or a Nazarbayev University package with admission; the national scholarship closes 30 June.",
  },
  {
    code: "jp",
    name: "Japan",
    how: "A professor's acceptance first, then MEXT (through the Japanese embassy, called around April, or a university's route September to November; ¥145k to 180k a month) or lab money.",
  },
  {
    code: "kr",
    name: "South Korea",
    aliases: ["korea", "republic of korea"],
    how: "Lab-funded: a professor's yes comes first, then the lab pays or GKS does (embassy track around February; ₩1.38M a month).",
  },
  {
    code: "cn",
    name: "China",
    how: "A Chinese Government Scholarship: Type A through the Chinese embassy (around January), Type B through the university (January to April); CNY 3,500 a month.",
  },
  {
    code: "hk",
    name: "Hong Kong",
    how: "HKPFS (closes 1 December; HK$344,400 a year) or a university studentship (about HK$229k a year) that comes with admission.",
  },
  {
    code: "mo",
    name: "Macau",
    aliases: ["macao"],
    how: "The University of Macau PhD scholarship (MOP 20,000 a month): first admission batch late October, funding round 8 January.",
  },
  {
    code: "tw",
    name: "Taiwan",
    how: "A MOE or MOFA Taiwan Scholarship through the Taipei office in your country (closes 31 March), or lab money.",
  },
  {
    code: "sg",
    name: "Singapore",
    how: "A university scholarship with admission (S$3,000 to 6,300 a month); SINGA closes 1 December, NTU's and NUS's around December.",
  },
  {
    code: "in",
    name: "India",
    how: "An institute stipend with admission (INR 31k to 73k a month), through the IIT and IISc portals, March to May.",
  },
  {
    code: "pk",
    name: "Pakistan",
    how: "University fellowships per program; little for foreigners.",
  },
  {
    code: "my",
    name: "Malaysia",
    how: "The Malaysia International Scholarship (around May) or a graduate research assistant post (RM 1,500 to 2,950 a month).",
  },
  {
    code: "th",
    name: "Thailand",
    how: "Thailand Scholarships (March; THB 8,000 a month) or a university's own scholarship.",
  },
  {
    code: "id",
    name: "Indonesia",
    how: "The KNB scholarship with admission (closes 30 June).",
  },
  {
    code: "vn",
    name: "Vietnam",
    aliases: ["viet nam"],
    how: "Institution-sponsored places; NAFOSTED grants name their PIs.",
  },
  {
    code: "ph",
    name: "Philippines",
    how: "SEARCA (Southeast Asian nationals only) or a university assistantship.",
  },
  {
    code: "mx",
    name: "Mexico",
    how: "Admission to a national-quality program brings a Becas Nacionales stipend (MXN 21,397 a month); AMEXCID closes 30 June. Spanish expected.",
  },
  {
    code: "br",
    name: "Brazil",
    how: "A CAPES-funded program place, or PEC-PG (autumn; R$3,100 a month). Portuguese expected.",
  },
  {
    code: "cl",
    name: "Chile",
    how: "ANID's national doctoral scholarship, open to foreigners (November the year before; CLP 7.8M a year). Spanish expected.",
  },
  {
    code: "ar",
    name: "Argentina",
    how: "A CONICET doctoral scholarship (closes around 21 August for an April start). Spanish expected.",
  },
  {
    code: "co",
    name: "Colombia",
    how: "An ICETEX scholarship for foreigners or a project post (March to June). Spanish expected.",
  },
  {
    code: "za",
    name: "South Africa",
    how: "NRF pays only part of the cost for international students (closes 3 July the year before); project posts at the universities.",
  },
  {
    code: "eg",
    name: "Egypt",
    how: "University fee waivers with thin stipends.",
  },
  {
    code: "ke",
    name: "Kenya",
    how: "Project fellowships (Wellcome, MSCA) at KEMRI and the universities.",
  },
  {
    code: "ng",
    name: "Nigeria",
    how: "Little for foreigners: the national schemes are for citizens.",
  },
  {
    code: "gh",
    name: "Ghana",
    how: "Project scholarships at the University of Ghana and KNUST.",
  },
  {
    code: "rw",
    name: "Rwanda",
    how: "Bilateral scholarships through the Higher Education Council (January).",
  },
  {
    code: "ma",
    name: "Morocco",
    how: "UM6P's funded PhD positions (closes 7 April).",
  },
];
