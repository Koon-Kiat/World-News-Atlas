const TOPIC_SIGNALS: Record<string, RegExp[]> = {
  politics: [
    /\belections?\b/,
    /\bparliament(?:ary)?\b/,
    /\bministers?\b/,
    /\bgovernment(?:s|al)?\b/,
    /\bdiplomac(?:y|ies)\b/,
    /\bdiplomatic\b/,
    /\bsummits?\b/,
    /\bpolitic(?:s|al)\b/,
  ],
  business: [
    /\btrad(?:e|es|ing)\b/,
    /\bmarkets?\b/,
    /\binvestments?\b/,
    /\beconom(?:y|ies|ic|ics)\b/,
    /\bbusiness(?:es)?\b/,
    /\bbanks?\b/,
    /\bbanking\b/,
    /\btariffs?\b/,
  ],
  technology: [
    /\btechnolog(?:y|ies|ical)\b/,
    /\bdigital\b/,
    /\bsemiconductors?\b/,
    /\bchips?\b/,
    /\bai\b/,
    /\bartificial intelligence\b/,
    /\bcyber(?:security|attack|crime|warfare)?\b/,
    /\bsoftware\b/,
  ],
  society: [
    /\beducation(?:al)?\b/,
    /\bhealth(?:care)?\b/,
    /\bhousing\b/,
    /\bcommunities?\b/,
    /\bpopulations?\b/,
    /\bsociet(?:y|ies|al)\b/,
  ],
  climate: [
    /\bclimate\b/,
    /\bemissions?\b/,
    /\brenewables?\b/,
    /\bweather\b/,
    /\bflood(?:s|ing|ed)?\b/,
    /\bwildfires?\b/,
  ],
  defence: [
    /\bdefen[cs]e\b/,
    /\bmilitary\b/,
    /\bnational security\b/,
    /\bnav(?:y|al)\b/,
    /\barm(?:y|ies)\b/,
  ],
  transport: [
    /\btransport(?:ation)?\b/,
    /\baviation\b/,
    /\brail(?:way|ways|road|roads)?\b/,
    /\bshipping\b/,
    /\bports?\b/,
    /\bairlines?\b/,
  ],
  culture: [
    /\bcultur(?:e|al)\b/,
    /\bfilms?\b/,
    /\bmusic(?:al)?\b/,
    /\bmuseums?\b/,
    /\barts?\b/,
    /\bfestivals?\b/,
  ],
  sports: [
    /\bsports?\b/,
    /\bfootball\b/,
    /\bolympics?\b/,
    /\bcricket\b/,
    /\btennis\b/,
    /\bchampionships?\b/,
  ],
};

export function detectTopics(title: string, description?: string | null): string[] {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  const topics = Object.entries(TOPIC_SIGNALS)
    .filter(([, signals]) => signals.some((signal) => signal.test(text)))
    .map(([topic]) => topic);
  return topics.length > 0 ? topics : ["world"];
}

export function topicLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
