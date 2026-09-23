import { richCommentPlainText } from "@/lib/rich-comment";

export function parseMeetingComment(message: string | null | undefined): {
  title: string;
  when: string | null;
} | null {
  if (!message?.trim()) return null;
  const plain = (richCommentPlainText(message) || message).replace(/\s+/g, " ").trim();
  const match = plain.match(/^(?:📅\s*)?Event or meeting:\s*(.+)$/i);
  if (!match?.[1]) return null;
  const rest = match[1].trim();
  if (!rest) return null;
  const withWhen = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (withWhen?.[1]?.trim()) {
    return { title: withWhen[1].trim(), when: withWhen[2]?.trim() || null };
  }
  return { title: rest, when: null };
}
