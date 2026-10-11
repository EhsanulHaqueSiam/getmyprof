// A hunt's places as ISO country codes: OpenAlex's awards filter by them.
const COUNTRY: Record<string, string> = {
  "united states": "us",
  usa: "us",
  us: "us",
  america: "us",
  canada: "ca",
  uk: "gb",
  "united kingdom": "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  britain: "gb",
  ireland: "ie",
  germany: "de",
  france: "fr",
  netherlands: "nl",
  belgium: "be",
  switzerland: "ch",
  austria: "at",
  sweden: "se",
  norway: "no",
  denmark: "dk",
  finland: "fi",
  spain: "es",
  portugal: "pt",
  italy: "it",
  poland: "pl",
  israel: "il",
  japan: "jp",
  korea: "kr",
  "south korea": "kr",
  china: "cn",
  "hong kong": "hk",
  taiwan: "tw",
  singapore: "sg",
  india: "in",
  australia: "au",
  "new zealand": "nz",
  brazil: "br",
  mexico: "mx",
  chile: "cl",
};

/** A hunt's places as ISO country codes, for OpenAlex's awards: "Japan, UK" as ["jp", "gb"]. */
export function placeCountries(places: string[]) {
  const where = ` ${places
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")} `;
  return [
    ...new Set(Object.entries(COUNTRY).flatMap(([n, c]) => (where.includes(` ${n} `) ? [c] : []))),
  ];
}
