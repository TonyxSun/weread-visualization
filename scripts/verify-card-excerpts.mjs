/**
 * Drives the shipped card excerpt filter (src/utils/cardExcerpts.ts).
 * Usage: npx tsx scripts/verify-card-excerpts.mjs
 */
import {
  excerptFitsCard,
  filterHighlightsForCardStyle,
  CARD_EXCERPT_LIMITS,
  normalizeExcerpt
} from "../src/utils/cardExcerpts.ts";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

const samples = [
  { markText: "短" }, // too short
  { markText: "这是一句刚好适合做成卡片的阅读金句，不多不少。" }, // ~22 ok
  { markText: "x".repeat(200) }, // too long for portable
  { markText: "  空白   折叠  " }, // short after normalize
  { markText: "中".repeat(100) }, // ok for terra, maybe tight for portable
  { markText: "中".repeat(150) } // ok terra/cleanse, fail portable
];

assert(normalizeExcerpt("  a  b  ") === "a b", "normalize collapses whitespace");
assert(!excerptFitsCard("hi", "terra"), "rejects too-short");
assert(excerptFitsCard("这是一句刚好适合做成卡片的阅读金句，不多不少。", "terra"), "accepts medium Chinese quote");
assert(!excerptFitsCard("x".repeat(500), "terra"), "rejects huge wall of text");

const portable = filterHighlightsForCardStyle(samples, "portable");
assert(
  portable.every((h) => excerptFitsCard(h.markText, "portable")),
  "portable filter only keeps fitting excerpts"
);
assert(
  portable.every((h) => {
    const n = normalizeExcerpt(h.markText).length;
    return n >= CARD_EXCERPT_LIMITS.portable.min && n <= CARD_EXCERPT_LIMITS.portable.max;
  }),
  "portable lengths within budget"
);

const terra = filterHighlightsForCardStyle(samples, "terra");
assert(terra.length >= portable.length, "terra budget admits at least as many as portable");

// Real-ish path: unfiltered deck would include long marks; filtered deck does not.
const deck = [
  { markText: "人生而自由，却无往不在枷锁之中。", id: 1 },
  { markText: "短", id: 2 },
  { markText: "段落。".repeat(80), id: 3 }
];
const fitted = filterHighlightsForCardStyle(deck, "journey");
assert(fitted.length === 1 && fitted[0].id === 1, "journey deck keeps only card-fit gold sentence");
assert(fitted.length < deck.length, "filter reduces full highlight list");

console.log("verify-card-excerpts PASS");
