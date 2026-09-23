export type MentionUser = {
  id: number;
  name: string | null;
  avatar?: string | null;
};

export const MENTION_TOKEN_REGEX = /«(\d+)\|([^»]+)»/g;

export function buildMentionToken(user: MentionUser) {
  return `«${user.id}|${user.name ?? "User"}»`;
}

export function buildCommentMessage(mentions: MentionUser[], body: string) {
  const trimmedBody = body.trim();
  const mentionLines = mentions.map((user) => buildMentionToken(user));
  if (mentionLines.length === 0) return trimmedBody;
  if (!trimmedBody) return mentionLines.join("\n");
  return `${mentionLines.join("\n")}\n${trimmedBody}`;
}

export function extractMentionedUserIds(message: string): number[] {
  const ids = new Set<number>();
  const regex = new RegExp(MENTION_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }

  return [...ids];
}

export function formatCommentPreview(message: string, maxLength = 120): string {
  const readable = message
    .replace(new RegExp(MENTION_TOKEN_REGEX.source, "g"), (_match, _id, name: string) => name)
    .replace(/\s+/g, " ")
    .trim();

  if (!readable) return "";
  return readable.length > maxLength ? `${readable.slice(0, maxLength)}…` : readable;
}

export function getMentionQuery(value: string, caretPosition: number) {
  const beforeCaret = value.slice(0, caretPosition);
  const atMatch = beforeCaret.match(/(?:^|\s)@([\w\s.]*)$/i);
  if (atMatch) {
    const raw = atMatch[0];
    const leadingSpace = raw.startsWith(" ") ? 1 : 0;
    return {
      query: atMatch[1] ?? "",
      start: beforeCaret.length - raw.length + leadingSpace,
      end: caretPosition,
      mode: "at" as const,
    };
  }

  return null;
}

export function filterMentionUsers(users: MentionUser[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return users.slice(0, 8);

  return users
    .filter((user) => {
      const name = user.name?.toLowerCase() ?? "";
      const parts = name.split(/\s+/);
      return (
        name.includes(normalized)
        || parts.some((part) => part.startsWith(normalized))
      );
    })
    .slice(0, 8);
}

/** Roles allowed in @-mention pickers (hide admin / HR / client). */
export function isMentionableUserRole(role?: string | null) {
  const normalized = String(role ?? "").toLowerCase();
  if (!normalized) return true;
  return normalized === "employee" || normalized === "manager";
}

export function filterMentionableUsers<T extends { role?: string | null }>(users: T[]): T[] {
  return users.filter((user) => isMentionableUserRole(user.role));
}

export function removeMentionQuery(value: string, start: number, end: number) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const merged = `${before}${after}`;
  return merged.replace(/^\s+/, "").replace(/\s{2,}/g, " ");
}

export type MessagePart =
  | { type: "text"; value: string }
  | { type: "mention"; userId: number; name: string };

export function parseCommentMessage(message: string, users: MentionUser[] = []): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  const tokenRegex = new RegExp(MENTION_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(message)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: message.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "mention",
      userId: Number(match[1]),
      name: match[2],
    });
    lastIndex = match.index + match[0].length;
  }

  const tail = message.slice(lastIndex);
  if (tail) {
    parts.push(...parseLegacyMentions(tail, users));
  }

  return parts.length > 0 ? parts : [{ type: "text", value: message }];
}

function parseLegacyMentions(text: string, users: MentionUser[]): MessagePart[] {
  const names = users
    .map((user) => user.name?.trim())
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => b.length - a.length);

  if (names.length === 0) {
    return [{ type: "text", value: text }];
  }

  const parts: MessagePart[] = [];
  let index = 0;

  while (index < text.length) {
    let matched: { name: string; user: MentionUser } | null = null;

    for (const name of names) {
      const atPattern = `@${name}`;
      if (text.startsWith(atPattern, index)) {
        const user = users.find((item) => item.name === name);
        if (user) matched = { name, user };
        break;
      }
    }

    if (!matched) {
      const nextAt = text.indexOf("@", index);
      const end = nextAt === -1 ? text.length : nextAt;
      if (end > index) {
        parts.push({ type: "text", value: text.slice(index, end) });
      }
      index = end === index ? index + 1 : end;
      continue;
    }

    parts.push({
      type: "mention",
      userId: matched.user.id,
      name: matched.name,
    });
    index += matched.name.length + 1;
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}
