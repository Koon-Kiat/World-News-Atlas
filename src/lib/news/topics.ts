const TOPIC_SIGNALS: Record<string, string[]> = {
  politics: ["election", "parliament", "minister", "government", "diplomacy", "summit"],
  business: ["trade", "market", "investment", "economy", "business", "bank", "tariff"],
  technology: ["technology", "digital", "semiconductor", "chip", "ai", "cyber", "software"],
  society: ["education", "health", "housing", "community", "population", "society"],
  climate: ["climate", "emissions", "renewable", "weather", "flood", "wildfire"],
  defence: ["defence", "defense", "military", "security", "navy", "army"],
  transport: ["transport", "aviation", "rail", "shipping", "port", "airline"],
  culture: ["culture", "film", "music", "museum", "arts", "festival"],
  sports: ["sport", "football", "olympic", "cricket", "tennis", "championship"],
};

export function detectTopics(title: string, description?: string | null): string[] {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  const topics = Object.entries(TOPIC_SIGNALS)
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([topic]) => topic);
  return topics.length > 0 ? topics : ["world"];
}

export function topicLabel(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
