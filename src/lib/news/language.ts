const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/gu;
const LETTER = /\p{L}/gu;

const LATIN_LANGUAGE_MARKERS: Record<string, Set<string>> = {
  en: new Set(["the", "and", "government", "announces", "new", "measures", "officials", "with", "from"]),
  fr: new Set(["le", "la", "les", "de", "des", "gouvernement", "annonce", "nouvelles", "mesures", "avec"]),
  de: new Set(["der", "die", "das", "regierung", "kündigt", "neue", "maßnahmen", "mit", "und"]),
  es: new Set(["el", "la", "los", "las", "gobierno", "anuncia", "nuevas", "medidas", "con", "y"]),
};

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
  if (letters >= 12 && latinLetters / letters >= 0.9) {
    const words = sample.toLocaleLowerCase().match(/\p{Script=Latin}+/gu) ?? [];
    const scores = Object.entries(LATIN_LANGUAGE_MARKERS)
      .map(([language, markers]) => ({
        language,
        score: words.reduce((total, word) => total + Number(markers.has(word)), 0),
      }))
      .sort((first, second) => second.score - first.score || first.language.localeCompare(second.language));
    if (scores[0]?.score >= 2 && scores[0].score > (scores[1]?.score ?? 0)) return scores[0].language;
  }
  // Han characters alone are shared by multiple languages. Without provider
  // metadata, keeping the value unknown is safer than misclassifying it.
  return "und";
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
