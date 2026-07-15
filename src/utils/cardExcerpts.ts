/**
 * Per-style character budgets so quote text fits fixed card layouts without
 * internal scrolling. Tuned for Chinese + mixed text on the five card styles.
 */
export type CardStyleId = "terra" | "portable" | "receipt" | "cleanse" | "journey";

export const CARD_EXCERPT_LIMITS: Record<CardStyleId, { min: number; max: number }> = {
  terra: { min: 12, max: 180 },
  portable: { min: 12, max: 110 },
  receipt: { min: 12, max: 140 },
  cleanse: { min: 12, max: 160 },
  journey: { min: 12, max: 160 }
};

export function normalizeExcerpt(text: string | undefined): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function excerptFitsCard(markText: string | undefined, style: CardStyleId): boolean {
  const len = normalizeExcerpt(markText).length;
  const { min, max } = CARD_EXCERPT_LIMITS[style];
  return len >= min && len <= max;
}

export function filterHighlightsForCardStyle<T extends { markText?: string }>(
  highlights: T[],
  style: CardStyleId
): T[] {
  return highlights.filter((h) => excerptFitsCard(h.markText, style));
}
