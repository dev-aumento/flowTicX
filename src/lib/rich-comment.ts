import { buildCommentMessage, extractMentionedUserIds, type MentionUser } from "@/lib/task-comment-mentions";
import { isImageMimeType, isVideoMimeType } from "@/lib/task-files";

export const RICH_COMMENT_MARKER = "<!--rich-comment-->";
/** Matches persisted media tokens. Negative ids are temporary (pre-upload) embeds. */
export const MEDIA_TOKEN_REGEX = /«media:(-?\d+)\|([^|»]+)\|([^»]+)»/g;
export const RICH_MEDIA_ID_ATTR = "data-rich-media-id";
export const RICH_MEDIA_NAME_ATTR = "data-rich-media-name";
export const RICH_MEDIA_MIME_ATTR = "data-rich-media-mime";

const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "A",
  "DIV",
  "SPAN",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "CAPTION",
  "COLGROUP",
  "COL",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "target", "rel"]),
  TD: new Set(["colspan", "rowspan"]),
  TH: new Set(["colspan", "rowspan"]),
  COL: new Set(["span"]),
  COLGROUP: new Set(["span"]),
};

/** Matches http(s) URLs and www.* hosts in plain text. */
export const PLAIN_TEXT_URL_REGEX =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi;

export function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeExternalUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  // Bare domain / path like example.com/docs
  if (
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i.test(
      trimmed,
    )
  ) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function isProbablyUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^https?:\/\/\S+/i.test(trimmed)) return true;
  if (/^www\.\S+/i.test(trimmed)) return true;
  // Bare domain: example.com/path
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i.test(
    trimmed,
  );
}

/** Convert plain text into HTML, wrapping detected URLs in anchors. */
export function linkifyPlainTextToHtml(text: string) {
  if (!text) return "";
  const escaped = escapeHtmlText(text);
  return escaped.replace(PLAIN_TEXT_URL_REGEX, (match) => {
    const href = normalizeExternalUrl(match);
    if (!/^https?:\/\//i.test(href)) return match;
    return `<a href="${escapeHtmlText(href)}" target="_blank" rel="noopener noreferrer">${match}</a>`;
  });
}

/** True when plain text looks like a spreadsheet / TSV table paste. */
export function plainTextLooksLikeTable(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized.includes("\t")) return false;
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  const tabbed = lines.filter((line) => line.includes("\t"));
  return tabbed.length >= 2;
}

/** Build a simple HTML table from tab-separated plain text (Excel / Sheets paste). */
export function plainTextTableToHtml(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) return "";

  const rows = lines
    .map((line) => {
      const cells = line.split("\t").map((cell) => {
        const html = linkifyPlainTextToHtml(cell);
        return `<td>${html || "<br>"}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `<table><tbody>${rows}</tbody></table>`;
}

/** True when sanitized HTML still contains a table structure. */
export function htmlContainsTable(html: string) {
  return /<table\b/i.test(html);
}

export type CommentMediaRef = {
  id: number;
  fileName: string;
  mimeType: string;
};

export type ParsedCommentMessage = {
  mentionPrefix: string;
  isRich: boolean;
  body: string;
  media: CommentMediaRef[];
};

/** Encode fields so `|` / `»` in file names cannot break media tokens. */
export function encodeMediaTokenField(value: string) {
  return value
    .replace(/%/g, "%25")
    .replace(/\|/g, "%7C")
    .replace(/»/g, "%BB");
}

export function decodeMediaTokenField(value: string) {
  return value
    .replace(/%7C/gi, "|")
    .replace(/%BB/gi, "»")
    .replace(/%25/g, "%");
}

export function buildMediaToken(media: CommentMediaRef) {
  return `«media:${media.id}|${encodeMediaTokenField(media.fileName)}|${encodeMediaTokenField(media.mimeType)}»`;
}

function mediaRefFromTokenMatch(match: RegExpMatchArray): CommentMediaRef {
  return {
    id: Number(match[1]),
    fileName: decodeMediaTokenField(match[2] ?? "file"),
    mimeType: decodeMediaTokenField(match[3] ?? "application/octet-stream"),
  };
}

export function extractMediaIdsFromBody(body: string) {
  const ids = new Set<number>();
  const regex = new RegExp(MEDIA_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    ids.add(Number(match[1]));
  }
  return ids;
}

/** True while an embed still uses a temporary (negative) upload id. */
export function hasPendingMediaRefs(html: string, media: CommentMediaRef[] = []) {
  if (media.some((item) => item.id <= 0)) return true;
  for (const id of extractMediaIdsFromBody(html)) {
    if (id <= 0) return true;
  }
  return false;
}

/** Drop pre-upload media tokens so they are never persisted as visible junk text. */
export function stripPendingMediaTokens(body: string) {
  return body.replace(/«media:-\d+\|[^|»]+\|[^»]+»/g, "").trim();
}

/** Keep the first occurrence of each media token and drop trailing duplicates. */
export function dedupeMediaInRichBody(body: string) {
  const segments = splitRichBodySegments(body);
  const seenIds = new Set<number>();
  const deduped = segments.filter((segment) => {
    if (segment.type === "html") return true;
    if (seenIds.has(segment.media.id)) return false;
    seenIds.add(segment.media.id);
    return true;
  });

  return deduped
    .map((segment) =>
      segment.type === "html" ? segment.value : buildMediaToken(segment.media),
    )
    .join("");
}

export function buildRichCommentMessage(
  mentions: MentionUser[],
  html: string,
  media: CommentMediaRef[] = [],
  options?: { keepPendingMedia?: boolean },
) {
  const mentionPrefix = buildCommentMessage(mentions, "").trim();
  const sanitizedBody = sanitizeRichCommentBody(html).trim();
  const sanitizedHtml = options?.keepPendingMedia
    ? sanitizedBody
    : stripPendingMediaTokens(sanitizedBody);
  const inlineIds = extractMediaIdsFromBody(sanitizedHtml);
  const trailingMedia = media.filter(
    (item) =>
      (options?.keepPendingMedia || item.id > 0) && !inlineIds.has(item.id),
  );
  const mediaBlock = trailingMedia.map(buildMediaToken).join("\n").trim();
  const richBody = dedupeMediaInRichBody(
    [sanitizedHtml, mediaBlock].filter(Boolean).join("\n"),
  );

  if (!mentionPrefix && !richBody) return "";
  if (!richBody) return mentionPrefix;
  if (!mentionPrefix) return `${RICH_COMMENT_MARKER}\n${richBody}`;
  return `${mentionPrefix}\n${RICH_COMMENT_MARKER}\n${richBody}`;
}

export function parseStoredCommentMessage(message: string): ParsedCommentMessage {
  const markerIndex = message.indexOf(RICH_COMMENT_MARKER);
  const media: CommentMediaRef[] = [];

  if (markerIndex === -1) {
    return {
      mentionPrefix: message,
      isRich: false,
      body: message,
      media,
    };
  }

  const mentionPrefix = message.slice(0, markerIndex).trim();
  const body = message.slice(markerIndex + RICH_COMMENT_MARKER.length).trim();
  // Use a fresh regex — shared /g regexes mutate lastIndex and break later .test()/matchAll.
  const mediaMatches = [...body.matchAll(new RegExp(MEDIA_TOKEN_REGEX.source, "g"))];
  for (const match of mediaMatches) {
    media.push(mediaRefFromTokenMatch(match));
  }

  return {
    mentionPrefix,
    isRich: true,
    body,
    media,
  };
}

export function stripMediaTokens(content: string) {
  return content.replace(new RegExp(MEDIA_TOKEN_REGEX.source, "g"), "").trim();
}

export function isRichCommentMessage(message: string) {
  return message.includes(RICH_COMMENT_MARKER);
}

export function sanitizeRichCommentHtml(html: string) {
  if (!html.trim()) return "";
  if (typeof document === "undefined") return html;

  const template = document.createElement("template");
  template.innerHTML = html;

  const sanitizeSpanAttrs = (element: HTMLElement, tag: string) => {
    for (const attr of [...element.attributes]) {
      const allowed = ALLOWED_ATTRS[tag];
      if (!allowed?.has(attr.name.toLowerCase())) {
        element.removeAttribute(attr.name);
      }
    }

    if (tag === "A") {
      const href = element.getAttribute("href") ?? "";
      const normalized = normalizeExternalUrl(href);
      if (!/^https?:\/\//i.test(normalized) && !/^mailto:/i.test(normalized)) {
        element.removeAttribute("href");
      } else {
        element.setAttribute("href", normalized);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    }

    if (tag === "TD" || tag === "TH") {
      for (const name of ["colspan", "rowspan"] as const) {
        const raw = element.getAttribute(name);
        if (raw == null) continue;
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, String(n));
        }
      }
    }
  };

  const walk = (node: Node) => {
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;

      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        child = next;
        continue;
      }

      if (child.nodeType === Node.TEXT_NODE) {
        child = next;
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        child = next;
        continue;
      }

      const element = child as HTMLElement;
      const tag = element.tagName.toUpperCase();

      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: move children before this node, then remove it and keep scanning
        // from the first moved child so nested tables/lists are still sanitized.
        const firstMoved = element.firstChild;
        while (element.firstChild) {
          node.insertBefore(element.firstChild, element);
        }
        element.remove();
        child = firstMoved ?? next;
        continue;
      }

      sanitizeSpanAttrs(element, tag);
      walk(element);
      child = next;
    }
  };

  walk(template.content);
  return template.innerHTML.trim();
}

export function richCommentPlainText(message: string) {
  const parsed = parseStoredCommentMessage(message);
  const source = parsed.isRich ? stripMediaTokens(parsed.body) : parsed.body;
  if (typeof document === "undefined") {
    return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = source;
  return div.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function extractMentionedUserIdsFromComment(message: string) {
  // Scan the full stored message so every «id|name» token is notified,
  // whether it sits in the mention prefix or elsewhere.
  return extractMentionedUserIds(message);
}

export function splitRichBodySegments(body: string) {
  const segments: Array<
    | { type: "html"; value: string }
    | { type: "media"; media: CommentMediaRef }
  > = [];

  let lastIndex = 0;
  const regex = new RegExp(MEDIA_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      const html = body.slice(lastIndex, match.index).trim();
      if (html) segments.push({ type: "html", value: html });
    }
    segments.push({
      type: "media",
      media: mediaRefFromTokenMatch(match),
    });
    lastIndex = match.index + match[0].length;
  }

  const tail = body.slice(lastIndex).trim();
  if (tail) segments.push({ type: "html", value: tail });

  return segments;
}

export function isEditorContentEmpty(html: string) {
  if (extractMediaIdsFromBody(html).size > 0) return false;
  // Empty list items / tables still count as content so the placeholder hides.
  if (/<(ul|ol|li|table|tr|td|th)\b/i.test(html)) return false;
  const text = html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text.length === 0;
}

export function sanitizeRichCommentBody(body: string) {
  if (!body.trim()) return "";
  const segments = splitRichBodySegments(body);
  if (segments.length === 0) return sanitizeRichCommentHtml(body);
  return segments
    .map((segment) =>
      segment.type === "html"
        ? sanitizeRichCommentHtml(segment.value)
        : buildMediaToken(segment.media),
    )
    .join("");
}

export function buildEditorBodyFromDraft(html: string, media: CommentMediaRef[] = []) {
  const trimmed = html.trim();
  // Body may already include «media:…» tokens (e.g. task description edit).
  // Never append initialMedia again in that case — and always dedupe.
  const inlineIds = extractMediaIdsFromBody(trimmed);
  if (inlineIds.size > 0) {
    return dedupeMediaInRichBody(trimmed);
  }
  const sanitized = sanitizeRichCommentHtml(trimmed);
  const mediaBlock = media.map(buildMediaToken).join("\n").trim();
  return dedupeMediaInRichBody([sanitized, mediaBlock].filter(Boolean).join("\n"));
}

function serializeRichEditorChildren(parent: HTMLElement, media: CommentMediaRef[], seenIds: Set<number>) {
  return Array.from(parent.childNodes).map((node) => serializeRichEditorNode(node, media, seenIds)).join("");
}

function serializeRichEditorNode(node: Node, media: CommentMediaRef[], seenIds: Set<number>): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const mediaId = element.getAttribute(RICH_MEDIA_ID_ATTR);
  if (mediaId) {
    const ref: CommentMediaRef = {
      id: Number(mediaId),
      fileName: element.getAttribute(RICH_MEDIA_NAME_ATTR) || "file",
      mimeType: element.getAttribute(RICH_MEDIA_MIME_ATTR) || "application/octet-stream",
    };
    if (!seenIds.has(ref.id)) {
      seenIds.add(ref.id);
      media.push(ref);
    }
    return buildMediaToken(ref);
  }

  const tag = element.tagName.toUpperCase();
  const children = serializeRichEditorChildren(element, media, seenIds);

  if (tag === "BR") return "<br>";
  if (tag === "STRONG" || tag === "B") return `<strong>${children}</strong>`;
  if (tag === "EM" || tag === "I") return `<em>${children}</em>`;
  if (tag === "U") return `<u>${children}</u>`;
  if (tag === "A") {
    const href = element.getAttribute("href") ?? "";
    return href ? `<a href="${href}">${children}</a>` : children;
  }
  if (tag === "UL") return `<ul>${children}</ul>`;
  if (tag === "OL") return `<ol>${children}</ol>`;
  if (tag === "LI") return `<li>${children}</li>`;
  if (tag === "TABLE") return `<table>${children}</table>`;
  if (tag === "THEAD") return `<thead>${children}</thead>`;
  if (tag === "TBODY") return `<tbody>${children}</tbody>`;
  if (tag === "TFOOT") return `<tfoot>${children}</tfoot>`;
  if (tag === "TR") return `<tr>${children}</tr>`;
  if (tag === "CAPTION") return `<caption>${children}</caption>`;
  if (tag === "COLGROUP") {
    const span = element.getAttribute("span");
    return span ? `<colgroup span="${span}">${children}</colgroup>` : `<colgroup>${children}</colgroup>`;
  }
  if (tag === "COL") {
    const span = element.getAttribute("span");
    return span ? `<col span="${span}">` : "<col>";
  }
  if (tag === "TH" || tag === "TD") {
    const parts: string[] = [];
    const colspan = element.getAttribute("colspan");
    const rowspan = element.getAttribute("rowspan");
    if (colspan) parts.push(`colspan="${colspan}"`);
    if (rowspan) parts.push(`rowspan="${rowspan}"`);
    const open = parts.length ? `<${tag.toLowerCase()} ${parts.join(" ")}>` : `<${tag.toLowerCase()}>`;
    return `${open}${children}</${tag.toLowerCase()}>`;
  }
  if (tag === "P" || tag === "DIV") return `<div>${children}</div>`;
  if (tag === "SPAN") return children ? `<span>${children}</span>` : "";

  return children;
}

export function serializeRichEditorDom(editor: HTMLElement): { html: string; media: CommentMediaRef[] } {
  const media: CommentMediaRef[] = [];
  const seenIds = new Set<number>();
  const html = Array.from(editor.childNodes)
    .map((node) => serializeRichEditorNode(node, media, seenIds))
    .join("");
  return { html, media };
}

const MEDIA_TILE_SIZE_PX = 150;

function createMediaEmbedElement(media: CommentMediaRef, previewUrl?: string) {
  const span = document.createElement("span");
  span.setAttribute(RICH_MEDIA_ID_ATTR, String(media.id));
  span.setAttribute(RICH_MEDIA_NAME_ATTR, media.fileName);
  span.setAttribute(RICH_MEDIA_MIME_ATTR, media.mimeType);
  span.contentEditable = "false";
  span.className = "rich-media-embed";
  // Uniform 150×150 tiles so images and documents share one grid.
  span.style.position = "relative";
  span.style.display = "inline-block";
  span.style.verticalAlign = "top";
  span.style.boxSizing = "border-box";
  span.style.width = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.height = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.minWidth = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.minHeight = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.maxWidth = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.maxHeight = `${MEDIA_TILE_SIZE_PX}px`;
  span.style.margin = "0 8px 8px 0";
  span.style.overflow = "hidden";
  span.style.borderRadius = "12px";
  span.style.border = "1px solid #E5E7EB";
  span.style.background = "#F9FAFB";

  const isImage = isImageMimeType(media.mimeType, media.fileName);
  const isVideo = isVideoMimeType(media.mimeType, media.fileName);

  if (previewUrl && isImage) {
    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = media.fileName;
    img.draggable = false;
    img.style.display = "block";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    span.appendChild(img);
  } else if (previewUrl && isVideo) {
    const video = document.createElement("video");
    video.src = previewUrl;
    video.muted = true;
    video.preload = "metadata";
    video.style.display = "block";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    span.appendChild(video);
  } else if (isImage || isVideo) {
    const label = document.createElement("span");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.justifyContent = "center";
    label.style.width = "100%";
    label.style.height = "100%";
    label.style.padding = "12px";
    label.style.boxSizing = "border-box";
    label.style.fontSize = "11px";
    label.style.color = "#4B5563";
    label.style.textAlign = "center";
    label.style.wordBreak = "break-word";
    label.textContent = media.fileName;
    span.appendChild(label);
  } else {
    const isPdf = media.mimeType.includes("pdf") || /\.pdf$/i.test(media.fileName);
    const body = document.createElement("span");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.alignItems = "center";
    body.style.justifyContent = "center";
    body.style.width = "100%";
    body.style.height = "100%";
    body.style.padding = "12px 10px";
    body.style.boxSizing = "border-box";
    body.style.gap = "8px";
    body.style.background = "#FFFFFF";

    const iconWrap = document.createElement("span");
    iconWrap.style.display = "inline-flex";
    iconWrap.style.alignItems = "center";
    iconWrap.style.justifyContent = "center";
    iconWrap.style.width = "48px";
    iconWrap.style.height = "48px";
    iconWrap.style.flexShrink = "0";
    iconWrap.style.borderRadius = "10px";
    iconWrap.style.fontSize = "12px";
    iconWrap.style.fontWeight = "700";
    iconWrap.style.background = isPdf ? "#FEF2F2" : "#F1F5F9";
    iconWrap.style.color = isPdf ? "#DC2626" : "#475569";
    const ext = media.fileName.includes(".")
      ? media.fileName.split(".").pop()!.slice(0, 4).toUpperCase()
      : "FILE";
    iconWrap.textContent = isPdf ? "PDF" : (ext || "FILE");

    const nameRow = document.createElement("span");
    nameRow.style.display = "block";
    nameRow.style.overflow = "hidden";
    nameRow.style.fontSize = "11px";
    nameRow.style.fontWeight = "600";
    nameRow.style.color = "#1F2937";
    nameRow.style.textAlign = "center";
    nameRow.style.wordBreak = "break-word";
    nameRow.style.lineHeight = "1.25";
    nameRow.style.maxWidth = "100%";
    nameRow.style.maxHeight = "2.5em";
    nameRow.textContent = media.fileName;
    nameRow.title = media.fileName;

    body.appendChild(iconWrap);
    body.appendChild(nameRow);
    span.appendChild(body);
  }

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.setAttribute("data-rich-media-remove", "true");
  removeButton.style.position = "absolute";
  removeButton.style.top = "4px";
  removeButton.style.right = "4px";
  removeButton.style.zIndex = "10";
  removeButton.style.display = "inline-flex";
  removeButton.style.alignItems = "center";
  removeButton.style.justifyContent = "center";
  removeButton.style.width = "20px";
  removeButton.style.height = "20px";
  removeButton.style.borderRadius = "9999px";
  removeButton.style.border = "none";
  removeButton.style.background = "rgba(0,0,0,0.6)";
  removeButton.style.color = "#fff";
  removeButton.style.fontSize = "12px";
  removeButton.style.lineHeight = "1";
  removeButton.style.cursor = "pointer";
  removeButton.setAttribute("aria-label", `Remove ${media.fileName}`);
  removeButton.textContent = "×";
  span.appendChild(removeButton);

  return span;
}

export function isPreviewableMedia(media: Pick<CommentMediaRef, "mimeType" | "fileName">) {
  return (
    isImageMimeType(media.mimeType, media.fileName)
    || isVideoMimeType(media.mimeType, media.fileName)
  );
}

/** Swap a placeholder embed for an image/video preview once the URL is ready. */
export function applyMediaEmbedPreview(
  editor: HTMLElement,
  mediaId: number,
  previewUrl: string,
) {
  const embed = editor.querySelector(
    `[${RICH_MEDIA_ID_ATTR}="${mediaId}"]`,
  ) as HTMLElement | null;
  if (!embed) return;

  const fileName = embed.getAttribute(RICH_MEDIA_NAME_ATTR) || "file";
  const mimeType = embed.getAttribute(RICH_MEDIA_MIME_ATTR) || "application/octet-stream";
  const replacement = createMediaEmbedElement(
    { id: mediaId, fileName, mimeType },
    previewUrl,
  );
  embed.replaceWith(replacement);
}

export function saveEditorSelection(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

export function insertMediaEmbedAtSelection(
  editor: HTMLElement,
  media: CommentMediaRef,
  previewUrl?: string,
  rangeOverride?: Range | null,
) {
  editor.focus();
  const span = createMediaEmbedElement(media, previewUrl);
  const selection = window.getSelection();
  let range: Range | null = rangeOverride ?? null;

  if (!range && selection && selection.rangeCount > 0) {
    const candidate = selection.getRangeAt(0);
    if (editor.contains(candidate.commonAncestorContainer)) {
      range = candidate;
    }
  }

  if (range && selection) {
    range.deleteContents();
    range.insertNode(span);
    const spacer = document.createTextNode("\u00a0");
    span.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  editor.appendChild(span);
  editor.appendChild(document.createTextNode("\u00a0"));
}

export function extractMediaFromBody(body: string, extra: CommentMediaRef[] = []) {
  const seen = new Set<number>();
  const media: CommentMediaRef[] = [];

  for (const segment of splitRichBodySegments(body)) {
    if (segment.type !== "media") continue;
    if (seen.has(segment.media.id)) continue;
    seen.add(segment.media.id);
    media.push(segment.media);
  }

  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    media.push(item);
  }

  return media;
}

export function hydrateRichEditorDom(
  editor: HTMLElement,
  body: string,
  previewUrls: Record<number, string> = {},
) {
  editor.innerHTML = "";
  const trimmed = body.trim();
  if (!trimmed) return;

  const segments = splitRichBodySegments(trimmed);
  if (segments.length === 0) {
    editor.innerHTML = sanitizeRichCommentHtml(trimmed);
    return;
  }

  for (const segment of segments) {
    if (segment.type === "html") {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = sanitizeRichCommentHtml(segment.value);
      while (wrapper.firstChild) {
        editor.appendChild(wrapper.firstChild);
      }
      continue;
    }

    editor.appendChild(
      createMediaEmbedElement(segment.media, previewUrls[segment.media.id]),
    );
  }
}

export function isRichEditorDomEmpty(editor: HTMLElement | null) {
  if (!editor) return true;
  if (editor.querySelector(`[${RICH_MEDIA_ID_ATTR}]`)) return false;
  // Bullet/number lists with empty items are still "content" for the placeholder.
  if (editor.querySelector("ul, ol")) return false;
  return isEditorContentEmpty(serializeRichEditorDom(editor).html);
}

/** Convert rich HTML into clipboard-friendly plain text that keeps lists and links. */
export function htmlToFormattedPlainText(html: string) {
  if (!html.trim()) return "";
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  const container = document.createElement("div");
  container.innerHTML = sanitizeRichCommentHtml(html);

  const walk = (node: Node, listContext?: { type: "ul" | "ol"; index: number }): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();

    if (tag === "BR") return "\n";

    if (tag === "A") {
      const href = element.getAttribute("href") ?? "";
      const label = Array.from(element.childNodes).map((child) => walk(child, listContext)).join("").trim();
      if (!label) return href;
      if (!href || href === label) return label;
      return `${label} (${href})`;
    }

    if (tag === "UL") {
      return Array.from(element.children)
        .map((child) => walk(child, { type: "ul", index: 0 }))
        .filter(Boolean)
        .join("\n");
    }

    if (tag === "OL") {
      return Array.from(element.children)
        .map((child, index) => walk(child, { type: "ol", index: index + 1 }))
        .filter(Boolean)
        .join("\n");
    }

    if (tag === "LI") {
      const content = Array.from(element.childNodes)
        .map((child) => walk(child))
        .join("")
        .trim();
      if (!content) return "";
      if (listContext?.type === "ol") return `${listContext.index}. ${content}`;
      return `• ${content}`;
    }

    if (tag === "TABLE") {
      return Array.from(element.querySelectorAll("tr"))
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("th,td")).map((cell) =>
            Array.from(cell.childNodes)
              .map((child) => walk(child))
              .join("")
              .replace(/\s+/g, " ")
              .trim(),
          );
          return cells.join("\t");
        })
        .filter((row) => row.length > 0)
        .join("\n");
    }

    if (tag === "THEAD" || tag === "TBODY" || tag === "TFOOT" || tag === "TR") {
      return Array.from(element.childNodes)
        .map((child) => walk(child, listContext))
        .filter((part) => part.trim().length > 0)
        .join(tag === "TR" ? "\t" : "\n");
    }

    if (tag === "TH" || tag === "TD" || tag === "CAPTION") {
      return Array.from(element.childNodes)
        .map((child) => walk(child, listContext))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (tag === "P" || tag === "DIV") {
      const content = Array.from(element.childNodes)
        .map((child) => walk(child, listContext))
        .join("")
        .trim();
      return content;
    }

    return Array.from(element.childNodes)
      .map((child) => walk(child, listContext))
      .join("");
  };

  return Array.from(container.childNodes)
    .map((child) => walk(child))
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getCommentClipboardPayload(message: string) {
  const parsed = parseStoredCommentMessage(message);

  if (!parsed.isRich) {
    const plain = message
      .replace(/«(\d+)\|([^»]+)»/g, (_m, _id, name: string) => name)
      .replace(/«media:\d+\|[^|»]+\|[^»]+»/g, "")
      .trim();
    const escaped = plain
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    return {
      html: `<div>${escaped}</div>`,
      text: plain,
    };
  }

  const mentionNames = [...parsed.mentionPrefix.matchAll(/«(\d+)\|([^»]+)»/g)]
    .map((match) => match[2])
    .filter(Boolean);

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  for (const name of mentionNames) {
    htmlParts.push(`<div><strong>${name}</strong></div>`);
    textParts.push(name);
  }

  const segments = splitRichBodySegments(parsed.body);
  for (const segment of segments) {
    if (segment.type === "html") {
      const html = sanitizeRichCommentHtml(segment.value);
      if (!html) continue;
      htmlParts.push(html);
      textParts.push(htmlToFormattedPlainText(html));
    } else {
      htmlParts.push(`<div>${segment.media.fileName}</div>`);
      textParts.push(segment.media.fileName);
    }
  }

  return {
    html: htmlParts.join(""),
    text: textParts.filter(Boolean).join("\n").trim(),
  };
}

export function plainTextToEditorHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n/)
    .map((line) => `<div>${line || "<br>"}</div>`)
    .join("");
}

export function getCommentEditDraft(
  message: string,
  mentionUsers: MentionUser[] = [],
) {
  const parsed = parseStoredCommentMessage(message);
  const mentions: MentionUser[] = [];

  const mentionTokenRegex = /«(\d+)\|([^»]+)»/g;
  let match: RegExpExecArray | null;
  const mentionSource = parsed.isRich ? parsed.mentionPrefix : message;

  while ((match = mentionTokenRegex.exec(mentionSource)) !== null) {
    const id = Number(match[1]);
    const existing = mentionUsers.find((user) => user.id === id);
    mentions.push(existing ?? { id, name: match[2] });
  }

  if (parsed.isRich) {
    return {
      mentions,
      html: parsed.body,
      media: parsed.media,
    };
  }

  // Legacy / edge cases: media tokens without the rich marker.
  const legacyMedia = [...message.matchAll(new RegExp(MEDIA_TOKEN_REGEX.source, "g"))].map(
    (mediaMatch) => mediaRefFromTokenMatch(mediaMatch),
  );

  const bodyWithoutMentionTokens = message
    .replace(/«\d+\|[^»]+»/g, "")
    .replace(new RegExp(MEDIA_TOKEN_REGEX.source, "g"), "")
    .replace(/\n+/g, "\n")
    .trim();

  if (legacyMedia.length > 0) {
    const mediaBlock = legacyMedia.map(buildMediaToken).join("\n");
    const textHtml = bodyWithoutMentionTokens
      ? plainTextToEditorHtml(bodyWithoutMentionTokens)
      : "";
    return {
      mentions,
      html: [textHtml, mediaBlock].filter(Boolean).join("\n"),
      media: legacyMedia,
    };
  }

  return {
    mentions,
    html: bodyWithoutMentionTokens ? plainTextToEditorHtml(bodyWithoutMentionTokens) : "",
    media: [] as CommentMediaRef[],
  };
}
