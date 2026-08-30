const DEFAULT_METADATA_LIMIT = 800;

export function cleanMetadataText(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

export function metadataExcerpt(
  value: string | null | undefined,
  maximum = DEFAULT_METADATA_LIMIT,
): { value: string | null; truncated: boolean } {
  if (!value) return { value: null, truncated: false };
  const cleaned = cleanMetadataText(value);
  if (!cleaned) return { value: null, truncated: false };
  if (cleaned.length <= maximum) return { value: cleaned, truncated: false };

  const candidate = cleaned.slice(0, maximum + 1);
  const punctuation = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf("！"),
  );
  const boundary = punctuation >= Math.floor(maximum * 0.65)
    ? punctuation + 1
    : candidate.lastIndexOf(" ");
  const end = boundary >= Math.floor(maximum * 0.65) ? boundary : maximum;
  return { value: `${candidate.slice(0, end).trimEnd()}…`, truncated: true };
}
