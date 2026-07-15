/**
 * Card quote fitting — character budgets + line-box geometry so excerpts
 * must render in full (no CSS clip) on each fixed card style.
 */

export type CardStyleId = "terra" | "portable" | "receipt" | "cleanse" | "journey";

/** Quote region geometry per style (px), matched to CardSwiper layouts. */
export interface QuoteBoxSpec {
  /** Usable text width */
  widthPx: number;
  /** Usable text height */
  heightPx: number;
  fontSizePx: number;
  lineHeight: number;
  /** Average glyph width as fraction of fontSize (≈1 for CJK, ~0.55 Latin). */
  cjkWidthRatio: number;
  latinWidthRatio: number;
  /** Hard length gates (after whitespace collapse) before geometry. */
  minChars: number;
  maxChars: number;
}

/**
 * Conservative boxes for the ~360–410px-wide card panel.
 * Prefer under-estimating capacity so text never clips.
 */
export const CARD_QUOTE_BOXES: Record<CardStyleId, QuoteBoxSpec> = {
  // Style 1: centered parchment, ~15px / leading 1.82, flex middle band
  terra: {
    widthPx: 200,
    heightPx: 168,
    fontSizePx: 15,
    lineHeight: 1.82,
    cjkWidthRatio: 1.0,
    latinWidthRatio: 0.55,
    minChars: 10,
    maxChars: 96
  },
  // Style 2: narrow mono column (39% width), max-h 148px
  portable: {
    widthPx: 108,
    heightPx: 140,
    fontSizePx: 12.5,
    lineHeight: 1.55,
    cjkWidthRatio: 1.0,
    latinWidthRatio: 0.6,
    minChars: 10,
    maxChars: 56
  },
  // Style 3: pixel receipt, 10px, middle flex band
  receipt: {
    widthPx: 150,
    heightPx: 120,
    fontSizePx: 10,
    lineHeight: 1.6,
    cjkWidthRatio: 1.0,
    latinWidthRatio: 0.55,
    minChars: 10,
    maxChars: 72
  },
  // Style 4: wide centered white type under cover, max-h 220 but cover steals space
  cleanse: {
    widthPx: 260,
    heightPx: 150,
    fontSizePx: 13,
    lineHeight: 1.72,
    cjkWidthRatio: 1.0,
    latinWidthRatio: 0.55,
    minChars: 10,
    maxChars: 90
  },
  // Style 5: right column 52% width, max-h 220 under large title
  journey: {
    widthPx: 170,
    heightPx: 160,
    fontSizePx: 13,
    lineHeight: 1.64,
    cjkWidthRatio: 1.0,
    latinWidthRatio: 0.55,
    minChars: 10,
    maxChars: 84
  }
};

/** @deprecated prefer CARD_QUOTE_BOXES — kept for older callers/tests */
export const CARD_EXCERPT_LIMITS: Record<CardStyleId, { min: number; max: number }> = {
  terra: { min: CARD_QUOTE_BOXES.terra.minChars, max: CARD_QUOTE_BOXES.terra.maxChars },
  portable: { min: CARD_QUOTE_BOXES.portable.minChars, max: CARD_QUOTE_BOXES.portable.maxChars },
  receipt: { min: CARD_QUOTE_BOXES.receipt.minChars, max: CARD_QUOTE_BOXES.receipt.maxChars },
  cleanse: { min: CARD_QUOTE_BOXES.cleanse.minChars, max: CARD_QUOTE_BOXES.cleanse.maxChars },
  journey: { min: CARD_QUOTE_BOXES.journey.minChars, max: CARD_QUOTE_BOXES.journey.maxChars }
};

export function normalizeExcerpt(text: string | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/** Estimate rendered width of a single line in the quote font. */
export function estimateLineWidthPx(line: string, box: QuoteBoxSpec): number {
  let w = 0;
  for (const ch of line) {
    w += box.fontSizePx * (isCjk(ch) ? box.cjkWidthRatio : box.latinWidthRatio);
  }
  return w;
}

/**
 * Greedy wrap simulation — returns how many visual lines `text` needs.
 */
export function estimateWrappedLineCount(text: string, box: QuoteBoxSpec): number {
  const normalized = normalizeExcerpt(text);
  if (!normalized) return 0;

  const paragraphs = normalized.split(/\n+/);
  let totalLines = 0;

  for (const para of paragraphs) {
    if (!para) {
      totalLines += 1;
      continue;
    }
    let lineWidth = 0;
    let linesInPara = 1;
    for (const ch of para) {
      const cw = box.fontSizePx * (isCjk(ch) ? box.cjkWidthRatio : box.latinWidthRatio);
      if (lineWidth > 0 && lineWidth + cw > box.widthPx) {
        linesInPara += 1;
        lineWidth = cw;
      } else {
        lineWidth += cw;
      }
    }
    totalLines += linesInPara;
  }

  return totalLines;
}

export function maxLinesForBox(box: QuoteBoxSpec): number {
  const linePx = box.fontSizePx * box.lineHeight;
  return Math.max(1, Math.floor(box.heightPx / linePx));
}

/**
 * Text as painted on the card (some styles wrap the excerpt in quote marks).
 */
export function paintedQuoteText(markText: string | undefined, style: CardStyleId): string {
  const body = normalizeExcerpt(markText);
  if (style === "portable") return `“${body}”`;
  return body;
}

/**
 * True only when the full excerpt is expected to paint inside the style's quote box.
 */
export function excerptFitsCard(markText: string | undefined, style: CardStyleId): boolean {
  const body = normalizeExcerpt(markText);
  const box = CARD_QUOTE_BOXES[style];
  if (body.length < box.minChars || body.length > box.maxChars) return false;

  const painted = paintedQuoteText(body, style);
  const lines = estimateWrappedLineCount(painted, box);
  const maxLines = maxLinesForBox(box);
  return lines > 0 && lines <= maxLines;
}

export function filterHighlightsForCardStyle<T extends { markText?: string }>(
  highlights: T[],
  style: CardStyleId
): T[] {
  return highlights.filter((h) => excerptFitsCard(h.markText, style));
}

/** Stable id for runtime overflow rejection. */
export function highlightCardKey(h: {
  bookmarkId?: string | number;
  bookId?: string;
  createTime?: number;
  markText?: string;
}): string {
  if (h.bookmarkId != null && String(h.bookmarkId).length > 0) return String(h.bookmarkId);
  return `${h.bookId || ""}:${h.createTime || 0}:${normalizeExcerpt(h.markText).slice(0, 40)}`;
}

/**
 * DOM overflow check — true when the element fully shows its text
 * (scrollHeight does not exceed clientHeight).
 * Returns null when layout is not ready (client box still 0) so callers skip.
 */
export function elementShowsFullText(el: HTMLElement, slackPx = 2): boolean | null {
  if (el.clientHeight < 8 || el.clientWidth < 8) return null;
  return el.scrollHeight <= el.clientHeight + slackPx;
}
