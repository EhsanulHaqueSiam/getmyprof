// A hunt's places as ISO country codes: the award sources, boards, windows and country lines all
// read codes, so "UK", "United Kingdom" and "Scotland" mean one thing.
import { COUNTRIES } from "./countries.ts";

const EU = "at be bg hr cy cz dk ee fi fr de gr hu ie it lv lt lu mt nl pl pt ro sk si es se";
const EEA = `${EU} is li no`;

/** Words for several countries at once, as the codes they mean. */
const BLOCS: Record<string, string> = {
  eu: EU,
  "european union": EU,
  eea: EEA,
  schengen:
    "at be bg hr cz dk ee fi fr de gr hu it lv lt lu mt nl pl pt ro sk si es se is li no ch",
  europe: `${EEA} ch gb rs`,
  european: `${EEA} ch gb rs`,
  nordic: "se no dk fi is",
  nordics: "se no dk fi is",
  scandinavia: "se no dk",
  baltics: "ee lv lt",
  baltic: "ee lv lt",
  benelux: "be nl lu",
  gulf: "sa ae qa om",
  gcc: "sa ae qa om",
  asean: "sg my th id vn ph",
  "southeast asia": "sg my th id vn ph",
  "east asia": "jp kr cn hk mo tw",
  "latin america": "mx br cl ar co",
  "south america": "br cl ar co",
};

/** Every word a place may use, longest first, so "latin america" is read before "america". */
const WORDS = [
  ...COUNTRIES.flatMap((c) =>
    [c.name.toLowerCase(), ...(c.aliases ?? [])].map((w) => [w, [c.code]] as const),
  ),
  ...Object.entries(BLOCS).map(([w, codes]) => [w, codes.split(" ")] as const),
].toSorted((a, b) => b[0].length - a[0].length);

/**
 * A hunt's places as ISO codes in the order they're named, whole words only: "Japan, UK" as
 * ["jp", "gb"], "Nordics" as five.
 * Bloc words expand unless `blocs` is false, for lists a person reads one line at a time.
 */
export function placeCountries(places: string[], blocs = true) {
  let where = ` ${places
    .join(" ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")} `;
  const found: [at: number, code: string][] = [];
  for (const [word, those] of WORDS) {
    const at = where.indexOf(` ${word} `);
    if (at < 0) continue;
    // Taken words leave a gap of the same length, so "new mexico" never also reads as Mexico.
    where = where.replaceAll(` ${word} `, ` ${" ".repeat(word.length)} `);
    if (blocs || those.length === 1) for (const c of those) found.push([at, c]);
  }
  return [...new Set(found.toSorted((a, b) => a[0] - b[0]).map(([, c]) => c))];
}

/** The countries a hunt's places name, for showing each one's line. */
export const countriesIn = (places: string[], blocs = true) =>
  placeCountries(places, blocs).flatMap((code) => COUNTRIES.filter((c) => c.code === code));
