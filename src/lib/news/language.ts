const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/gu;
const LETTER = /\p{L}/gu;

export const LANGUAGE_LABELS: Record<string, string> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ru: "Russian",
  und: "Unknown",
  zh: "Chinese",
};

export function normalizeLanguageCode(value: string | null | undefined): string | null {
  const language = value?.trim().toLowerCase();
  return language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(language) ? language : null;
}

export function inferArticleLanguage(
  declaredLanguage: string | null | undefined,
  ...text: Array<string | null | undefined>
): string {
  const declared = normalizeLanguageCode(declaredLanguage);
  if (declared) return declared;
  const sample = text.filter(Boolean).join(" ").normalize("NFKC");
  if (JAPANESE_KANA.test(sample)) return "ja";
  if (HANGUL.test(sample)) return "ko";
  const letters = sample.match(LETTER)?.length ?? 0;
  const latinLetters = sample.match(LATIN)?.length ?? 0;
  if (letters >= 12 && latinLetters / letters >= 0.9) return "en";
  // Han characters alone are shared by multiple languages. Without provider
  // metadata, keeping the value unknown is safer than misclassifying it.
  return "und";
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
