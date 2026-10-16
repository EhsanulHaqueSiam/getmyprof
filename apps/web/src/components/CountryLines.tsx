import { countriesIn } from "@getmyprof/contracts";

/**
 * How each country the places name funds a PhD for someone from abroad, one line each. Bloc
 * words ("Europe") list nothing here; the agent still reads every country in them.
 */
export function CountryLines({ places }: { places: string[] }) {
  return countriesIn(places, false).map((c) => (
    <p key={c.code} data-testid="country-line" className="text-xs">
      {c.name} <span className="text-muted-foreground">{c.how}</span>
    </p>
  ));
}
