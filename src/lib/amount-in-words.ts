const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

const CURRENCY_WORDS: Record<
  string,
  { major: string; minor: string; useIndianScale?: boolean }
> = {
  INR: { major: "Indian Rupee", minor: "Paise", useIndianScale: true },
  USD: { major: "US Dollar", minor: "Cents" },
  EUR: { major: "Euro", minor: "Cents" },
  GBP: { major: "British Pound", minor: "Pence" },
  AED: { major: "UAE Dirham", minor: "Fils" },
  AUD: { major: "Australian Dollar", minor: "Cents" },
  CAD: { major: "Canadian Dollar", minor: "Cents" },
  SGD: { major: "Singapore Dollar", minor: "Cents" },
  JPY: { major: "Japanese Yen", minor: "" },
  CHF: { major: "Swiss Franc", minor: "Centimes" },
  NZD: { major: "New Zealand Dollar", minor: "Cents" },
  SAR: { major: "Saudi Riyal", minor: "Halalas" },
  QAR: { major: "Qatari Riyal", minor: "Dirhams" },
  HKD: { major: "Hong Kong Dollar", minor: "Cents" },
};

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] || "";
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return [TENS[ten], ONES[one]].filter(Boolean).join(" ");
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(" ");
}

function indianScaleWords(rupees: number): string {
  const crore = Math.floor(rupees / 1_00_00_000);
  const lakh = Math.floor((rupees % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((rupees % 1_00_000) / 1000);
  const hundred = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(" ");
}

function westernScaleWords(n: number): string {
  if (n === 0) return "Zero";
  const billion = Math.floor(n / 1_000_000_000);
  const million = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (billion) parts.push(`${threeDigits(billion)} Billion`);
  if (million) parts.push(`${threeDigits(million)} Million`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** Converts a number to Indian currency words, e.g. "Indian Rupee ... Only". */
export function amountInIndianWords(amount: number): string {
  return amountInCurrencyWords(amount, "INR");
}

/** Converts amount to words for the selected invoice currency. */
export function amountInCurrencyWords(amount: number, currency = "INR"): string {
  const code = (currency || "INR").toUpperCase();
  const meta = CURRENCY_WORDS[code] ?? {
    major: code,
    minor: "Cents",
    useIndianScale: false,
  };
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const major = Math.floor(safe);
  const minor = code === "JPY" ? 0 : Math.round((safe - major) * 100);

  if (major === 0 && minor === 0) {
    return `${meta.major} Zero Only`;
  }

  const majorWords = meta.useIndianScale
    ? indianScaleWords(major) || "Zero"
    : westernScaleWords(major);

  let result = `${meta.major} ${majorWords}`;
  if (minor > 0 && meta.minor) {
    result += ` and ${twoDigits(minor)} ${meta.minor}`;
  }
  return `${result} Only`;
}
