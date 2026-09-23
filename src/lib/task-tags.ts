/** Tags stored on the task document (`tags`) or in `metadata.tags`. */
export function extractTaskTags(task: unknown): string[] {
  if (!task || typeof task !== "object") return [];
  const rec = task as { tags?: unknown; metadata?: unknown };
  if (Array.isArray(rec.tags)) {
    return normalizeTagList(rec.tags);
  }
  const meta = rec.metadata;
  if (meta && typeof meta === "object" && Array.isArray((meta as { tags?: unknown }).tags)) {
    return normalizeTagList((meta as { tags: unknown[] }).tags);
  }
  return [];
}

function normalizeTagList(tags: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const value = tag.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
