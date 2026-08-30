import topicSignalData from "@/data/topic-signals.json";

interface TopicDefinition {
  slug: string;
  label: string;
  signals: Record<string, string[]>;
}

export const TOPIC_DEFINITIONS = topicSignalData as TopicDefinition[];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesSignal(text: string, signal: string): boolean {
  const escaped = escapeRegExp(signal.normalize("NFKC").toLocaleLowerCase());
  if (/^[\p{Script=Latin}\p{N} ]+$/u.test(signal)) {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
  }
  return text.includes(signal.normalize("NFKC").toLocaleLowerCase());
}

export function detectTopics(title: string, description?: string | null): string[] {
  const text = `${title} ${description ?? ""}`.normalize("NFKC").toLocaleLowerCase();
  const topics = TOPIC_DEFINITIONS
    .filter(({ signals }) => Object.values(signals).flat().some((signal) => matchesSignal(text, signal)))
    .map(({ slug }) => slug);
  return topics.length > 0 ? topics : ["world"];
}

export function topicLabel(slug: string): string {
  return TOPIC_DEFINITIONS.find((topic) => topic.slug === slug)?.label ??
    slug.charAt(0).toUpperCase() + slug.slice(1);
}
