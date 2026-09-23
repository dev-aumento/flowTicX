/** Visual badge for a public holiday, matched from the holiday name. */
export type HolidayVisual = {
  /** Emoji glyph when no image flag is used */
  emoji: string;
  /** Use a drawn country flag instead of the 🇮🇳 emoji (often shows as “IN” on Windows). */
  flag?: "in";
  /** Short accessibility / tooltip hint */
  label: string;
};

/**
 * Pick an emoji from the holiday name so calendar cells stay clear.
 * Matching is intentional and order-sensitive (more specific rules first).
 * Optional `dateKey` (YYYY-MM-DD) forces the India flag on Republic / Independence dates.
 */
export function holidayVisualForName(name: string, dateKey?: string): HolidayVisual {
  const n = name.trim().toLowerCase();
  const monthDay = dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(5) : "";

  // National holidays — India flag (by fixed date and/or name, including common misspellings)
  const isNationalByDate = monthDay === "01-26" || monthDay === "08-15";
  const isNationalByName =
    /\brepublic\b/.test(n) ||
    /independ/.test(n) || // Independence / Independance / Indenepdance…
    /\bi[\s-]?day\b/.test(n) ||
    /\bgandhi\s*jayanti\b/.test(n) ||
    n.includes("national holiday") ||
    n.includes("national day");

  if (isNationalByDate || isNationalByName) {
    return { emoji: "🇮🇳", flag: "in", label: "National holiday" };
  }

  // Makarsankranti / Uttarayan — kite
  if (
    n.includes("makar") ||
    n.includes("sankranti") ||
    n.includes("uttarayan") ||
    n.includes("kite")
  ) {
    return { emoji: "🪁", label: "Makarsankranti" };
  }

  // Holi — fire; colour / rang festivals get the palette
  if (n.includes("holi")) {
    return { emoji: "🔥", label: "Holi" };
  }
  if (n.includes("colour") || n.includes("color") || n.includes("rangoli") || n.includes("rang panchami")) {
    return { emoji: "🎨", label: "Colours" };
  }

  // Rakshabandhan — rakhi
  if (n.includes("raksha") || n.includes("rakhi") || n.includes("bandhan")) {
    return { emoji: "🎀", label: "Rakshabandhan" };
  }

  // Other common Indian / company holidays
  if (n.includes("diwali") || n.includes("deepavali") || n.includes("deepawali")) {
    return { emoji: "🪔", label: "Diwali" };
  }
  if (n.includes("dussehra") || n.includes("dasara") || n.includes("vijaya")) {
    return { emoji: "🏹", label: "Dussehra" };
  }
  if (n.includes("ganesh") || n.includes("ganpati")) {
    return { emoji: "🐘", label: "Ganesh Chaturthi" };
  }
  if (n.includes("navratri") || n.includes("navaratri") || n.includes("durga")) {
    return { emoji: "🪔", label: "Navratri" };
  }
  if (n.includes("eid") || n.includes("ramzan") || n.includes("ramadan")) {
    return { emoji: "🌙", label: "Eid" };
  }
  if (n.includes("christmas")) {
    return { emoji: "🎄", label: "Christmas" };
  }
  if (n.includes("good friday") || n.includes("easter")) {
    return { emoji: "✝️", label: "Christian holiday" };
  }
  if (n.includes("new year")) {
    return { emoji: "🎆", label: "New Year" };
  }
  if (n.includes("janmashtami") || n.includes("krishna")) {
    return { emoji: "🪶", label: "Janmashtami" };
  }
  if (n.includes("onam")) {
    return { emoji: "🌺", label: "Onam" };
  }
  if (n.includes("pongal")) {
    return { emoji: "🍚", label: "Pongal" };
  }

  return { emoji: "🎉", label: name.trim() || "Public holiday" };
}
