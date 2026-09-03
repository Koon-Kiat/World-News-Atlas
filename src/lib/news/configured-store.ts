import "server-only";
import { getSitesD1Binding } from "@/lib/db/d1";
import { D1NewsStore } from "./d1-store";
import type { NewsStore } from "./store";

export async function getConfiguredNewsStore(): Promise<NewsStore | null> {
  const database = await getSitesD1Binding();
  return database ? new D1NewsStore(database) : null;
}
