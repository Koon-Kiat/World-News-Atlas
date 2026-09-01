/**
 * Live discovery is isolated behind this boundary so a deployment can replace
 * the process-local implementation with a supported shared store. The current
 * Sites project has no shared live-state binding configured, so memory remains
 * the explicit development/host fallback.
 */
export interface LiveStateStore<T extends { expiresAt: number }> {
  readonly kind: "memory" | "shared";
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  entries(): IterableIterator<[string, T]>;
  size(): number;
  clear(): void;
}

export class MemoryLiveStateStore<T extends { expiresAt: number }> implements LiveStateStore<T> {
  readonly kind = "memory" as const;
  private readonly values = new Map<string, T>();

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  set(key: string, value: T): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  entries(): IterableIterator<[string, T]> {
    return this.values.entries();
  }

  size(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }
}
