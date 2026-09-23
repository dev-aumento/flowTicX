import { Country, State } from "country-state-city";

/** Map our display country names to ISO 3166-1 alpha-2 when package names differ. */
const COUNTRY_ISO_ALIASES: Record<string, string> = {
  "Cabo Verde": "CV",
  "Congo (Congo-Brazzaville)": "CG",
  "Czechia": "CZ",
  "Democratic Republic of the Congo": "CD",
  Eswatini: "SZ",
  "Ivory Coast": "CI",
  Myanmar: "MM",
  "North Korea": "KP",
  "North Macedonia": "MK",
  Palestine: "PS",
  Russia: "RU",
  "South Korea": "KR",
  Taiwan: "TW",
  "Timor-Leste": "TL",
  "United Kingdom": "GB",
  "United States": "US",
  "Vatican City": "VA",
  Vietnam: "VN",
};

const countryIsoByLowerName = (() => {
  const map = new Map<string, string>();
  for (const country of Country.getAllCountries()) {
    map.set(country.name.toLowerCase(), country.isoCode);
  }
  return map;
})();

export function getCountryIsoCode(countryName: string): string | null {
  const name = countryName.trim();
  if (!name) return null;
  if (COUNTRY_ISO_ALIASES[name]) return COUNTRY_ISO_ALIASES[name];
  return countryIsoByLowerName.get(name.toLowerCase()) ?? null;
}

/** State / province / region names for a country. Empty when none are defined. */
export function getStatesForCountry(countryName: string): string[] {
  const iso = getCountryIsoCode(countryName);
  if (!iso) return [];
  return State.getStatesOfCountry(iso)
    .map((state) => state.name)
    .sort((a, b) => a.localeCompare(b));
}
