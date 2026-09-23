import { memo, type ClipboardEvent, type ReactNode } from "react";
import { parseCommentMessage, type MentionUser } from "@/lib/task-comment-mentions";
import { useAuth } from "@/hooks/useAuth";
import {
  dedupeMediaInRichBody,
  htmlToFormattedPlainText,
  parseStoredCommentMessage,
  sanitizeRichCommentHtml,
  splitRichBodySegments,
  type CommentMediaRef,
} from "@/lib/rich-comment";
import { CommentMediaBlock } from "@/components/tasks/CommentMediaBlock";
import { cn } from "@/lib/utils";

type BodySegment = ReturnType<typeof splitRichBodySegments>[number];

type RenderBlock =
  | { type: "html"; html: string }
  | { type: "media-grid"; media: CommentMediaRef[] };

function isBlankHtml(html: string) {
  const text = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  return text.length === 0;
}

/** Collapse consecutive media (images + files) into one uniform 150×150 grid. */
function groupSegmentsForDisplay(segments: BodySegment[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let mediaBuffer: CommentMediaRef[] = [];

  const flushMedia = () => {
    if (mediaBuffer.length === 0) return;
    blocks.push({ type: "media-grid", media: mediaBuffer });
    mediaBuffer = [];
  };

  for (const segment of segments) {
    if (segment.type === "media") {
      if (segment.media.id <= 0) continue;
      mediaBuffer.push(segment.media);
      continue;
    }

    if (isBlankHtml(segment.value)) {
      continue;
    }

    flushMedia();
    blocks.push({ type: "html", html: segment.value });
  }

  flushMedia();
  return blocks;
}

function mentionLabel(part: { userId: number; name: string }, viewerId?: number | null) {
  return viewerId != null && Number(part.userId) === Number(viewerId) ? "you" : part.name;
}

function renderPlainMentions(
  message: string,
  mentionUsers: MentionUser[],
  viewerId?: number | null,
) {
  const parts = parseCommentMessage(message, mentionUsers);
  const mentionParts = parts.filter(
    (part): part is Extract<typeof part, { type: "mention" }> => part.type === "mention",
  );

  // Mention-only prefix (one or more @people): always show as a horizontal chip row.
  const onlyMentionsAndWhitespace = parts.every(
    (part) =>
      part.type === "mention"
      || (part.type === "text" && !part.value.replace(/\s+/g, "").length),
  );

  if (onlyMentionsAndWhitespace && mentionParts.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {mentionParts.map((part, index) => (
          <span
            key={`mention-${part.userId}-${index}`}
            className="inline-flex font-medium text-[#2563EB]"
          >
            {mentionLabel(part, viewerId)}
          </span>
        ))}
      </div>
    );
  }

  const nodes: ReactNode[] = [];

  for (const [index, part] of parts.entries()) {
    if (part.type === "mention") {
      nodes.push(
        <span
          key={`mention-${index}`}
          className="inline font-medium text-[#2563EB]"
        >
          {mentionLabel(part, viewerId)}
        </span>,
      );
      continue;
    }

    if (!part.value) continue;
    // Don't force line breaks between mention tokens from older comments.
    const normalized = part.value.replace(/^\n+|\n+$/g, (match) =>
      match.length > 1 ? "\n" : "",
    );
    if (!normalized.replace(/\s+/g, "").length && mentionParts.length > 0) {
      nodes.push(<span key={`gap-${index}`}>{" "}</span>);
      continue;
    }
    nodes.push(
      <span key={`text-${index}`} className="whitespace-pre-wrap break-words">
        {normalized}
      </span>,
    );
  }

  return nodes;
}

/**
 * Copy only the user's selected range.
 * Prefer the browser selection string; optionally enrich with formatted plain text
 * from the selected HTML when that conversion succeeds.
 */
function handleCommentCopy(event: ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const currentTarget = event.currentTarget;
  if (!selection.anchorNode || !currentTarget.contains(selection.anchorNode)) {
    return;
  }

  const selectedText = selection.toString();
  if (!selectedText) return;

  let html = "";
  let formatted = "";
  try {
    const range = selection.getRangeAt(0);
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    html = sanitizeRichCommentHtml(container.innerHTML);
    formatted = html ? htmlToFormattedPlainText(html) : "";
  } catch {
    // Fall through to native copy of the selection.
    return;
  }

  const text = formatted.trim() ? formatted : selectedText;
  if (!text) return;

  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  if (html.trim()) {
    event.clipboardData.setData("text/html", html);
  }
}

type CommentRichContentProps = {
  message: string;
  mentionUsers: MentionUser[];
  className?: string;
  /** Description/comment layout: text blocks + uniform media grid. */
  inlineMedia?: boolean;
};

function CommentRichContentInner({
  message,
  mentionUsers,
  className,
}: CommentRichContentProps) {
  const { user } = useAuth();
  const parsed = parseStoredCommentMessage(message);

  if (!parsed.isRich) {
    return (
      <div
        className={cn("min-w-0 max-w-full break-words select-text", className)}
        onCopy={handleCommentCopy}
      >
        {renderPlainMentions(message, mentionUsers, user?.id)}
      </div>
    );
  }

  const segments = splitRichBodySegments(dedupeMediaInRichBody(parsed.body));
  // Always use uniform 150×150 tiles in a wrapping grid (composer + sent comments).
  const blocks = groupSegmentsForDisplay(segments);

  return (
    <div
      className={cn("min-w-0 max-w-full break-words select-text", className)}
      onCopy={handleCommentCopy}
    >
      {parsed.mentionPrefix ? (
        <div className="mb-2">
          {renderPlainMentions(parsed.mentionPrefix, mentionUsers, user?.id)}
        </div>
      ) : null}

      {blocks.length > 0 ? (
        <div className="rich-comment-content min-w-0 max-w-full space-y-3 text-sm text-gray-800">
          {blocks.map((block, index) => {
            if (block.type === "html") {
              return (
                <div
                  key={`html-${index}`}
                  className="rich-comment-html min-w-0 max-w-full overflow-x-auto [&_a]:text-[#2563EB] [&_a]:underline [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeRichCommentHtml(block.html),
                  }}
                />
              );
            }

            return (
              <div
                key={`media-grid-${index}`}
                className="flex flex-wrap gap-2"
              >
                {block.media.map((media) => (
                  <CommentMediaBlock
                    key={`media-${media.id}`}
                    media={media}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export const CommentRichContent = memo(CommentRichContentInner);
