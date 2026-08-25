import type { StoryView } from "@/lib/news/types";
import { StoryCard } from "./StoryCard";

export function StoryList({ stories }: { stories: StoryView[] }) {
  if (stories.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden="true">◎</span>
        <h3>No strong match yet</h3>
        <p>Try a wider time range, another perspective, or clear one filter.</p>
      </div>
    );
  }
  return (
    <div className="story-grid">
      {stories.map((story, index) => (
        <StoryCard key={story.id} story={story} featured={index === 0} />
      ))}
    </div>
  );
}
