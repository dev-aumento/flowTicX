/** Reactions stored on comment activity metadata. */
export type CommentReactionsMap = Record<string, number[]>;

export function readCommentReactions(
  metadata: Record<string, unknown> | null | undefined,
): CommentReactionsMap {
  if (!metadata || typeof metadata !== "object") return {};
  const raw = metadata.reactions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: CommentReactionsMap = {};
  for (const [emoji, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!emoji.trim()) continue;
    if (!Array.isArray(value)) continue;
    const userIds = value
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (userIds.length > 0) {
      result[emoji] = [...new Set(userIds)];
    }
  }
  return result;
}

export function toggleUserReaction(
  reactions: CommentReactionsMap,
  emoji: string,
  userId: number,
): CommentReactionsMap {
  const next: CommentReactionsMap = { ...reactions };
  const current = [...(next[emoji] ?? [])];
  const index = current.indexOf(userId);
  if (index >= 0) {
    current.splice(index, 1);
  } else {
    current.push(userId);
  }
  if (current.length === 0) {
    delete next[emoji];
  } else {
    next[emoji] = current;
  }
  return next;
}

export function commentReactionSummary(
  reactions: CommentReactionsMap,
  currentUserId?: number | null,
): Array<{ emoji: string; count: number; reactedByMe: boolean }> {
  return Object.entries(reactions)
    .map(([emoji, userIds]) => ({
      emoji,
      count: userIds.length,
      reactedByMe: currentUserId != null ? userIds.includes(currentUserId) : false,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
