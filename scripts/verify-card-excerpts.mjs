/**
 * Drives shipped card excerpt geometry filter + optional live DOM check.
 * Usage: npx tsx scripts/verify-card-excerpts.mjs
 */
import {
  excerptFitsCard,
  filterHighlightsForCardStyle,
  CARD_QUOTE_BOXES,
  CARD_EXCERPT_LIMITS,
  normalizeExcerpt,
  estimateWrappedLineCount,
  maxLinesForBox,
  elementShowsFullText
} from "../src/utils/cardExcerpts.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

// ── Unit geometry ────────────────────────────────────────────────────────────
assert(normalizeExcerpt("  a  b  ") === "a b", "normalize collapses whitespace");
assert(!excerptFitsCard("hi", "terra"), "rejects too-short");
assert(
  excerptFitsCard("生命意志就是不顾一切让自身生存的意志。", "terra"),
  "accepts short Chinese quote on terra"
);
assert(!excerptFitsCard("中".repeat(500), "terra"), "rejects huge wall of text");
assert(
  !excerptFitsCard("中".repeat(120), "portable"),
  "portable rejects text over geometry budget"
);

// ~120 CJK chars — over terra maxChars (96) and line budget
const longParagraph = "中".repeat(120);
assert(!excerptFitsCard(longParagraph, "terra"), "120 CJK wall fails terra full-fit");
assert(!excerptFitsCard(longParagraph, "portable"), "120 CJK wall fails portable");
// Borderline: text that wraps past maxLines even if under maxChars
const multiLineBleed = "生命意志就是不顾一切让自身生存的意志。".repeat(4); // ~76+ chars depending
const bleedLines = estimateWrappedLineCount(multiLineBleed, CARD_QUOTE_BOXES.terra);
if (bleedLines > maxLinesForBox(CARD_QUOTE_BOXES.terra)) {
  assert(!excerptFitsCard(multiLineBleed, "terra"), "over-line text fails even under soft char cap path");
}

// Synthetic wrap: box that holds ~10 CJK chars/line and 3 lines → max ~30
const tinyBox = {
  widthPx: 150,
  heightPx: 48,
  fontSizePx: 15,
  lineHeight: 1.6,
  cjkWidthRatio: 1,
  latinWidthRatio: 0.55,
  minChars: 1,
  maxChars: 200
};
const threeLines = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十"; // 30
assert(estimateWrappedLineCount(threeLines, tinyBox) <= 3 + 1, "wrap estimate sane for 30 CJK");
assert(maxLinesForBox(tinyBox) === 2, "maxLines floors height/linePx"); // 48/(15*1.6)=2

// ── Real DB highlights (if present) ──────────────────────────────────────────
const dbPath = path.join(root, "data", "weread.db");
if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("SELECT mark_text AS markText FROM highlights").all();
  assert(rows.length > 0, `db has ${rows.length} highlights`);

  for (const style of Object.keys(CARD_QUOTE_BOXES)) {
    const fit = filterHighlightsForCardStyle(rows, style);
    const box = CARD_QUOTE_BOXES[style];
    const maxLines = maxLinesForBox(box);
    assert(fit.length > 0, `${style}: at least one highlight fits (${fit.length}/${rows.length})`);
    assert(fit.length < rows.length, `${style}: filter reduces full set (${fit.length}<${rows.length})`);

    for (const h of fit) {
      const text = normalizeExcerpt(h.markText);
      const lines = estimateWrappedLineCount(text, box);
      if (lines > maxLines) {
        console.error("overflow candidate", style, text.length, lines, maxLines, text.slice(0, 40));
        process.exit(1);
      }
      if (text.length > box.maxChars || text.length < box.minChars) {
        console.error("length gate broken", style, text.length);
        process.exit(1);
      }
    }
    const maxLen = Math.max(...fit.map((h) => normalizeExcerpt(h.markText).length));
    console.log(
      `  ${style}: fit ${fit.length}/${rows.length} maxLen=${maxLen} maxLines=${maxLines} (limit ${CARD_EXCERPT_LIMITS[style].max})`
    );
  }

  // Longest DB rows must not pass portable
  const longest = [...rows].sort(
    (a, b) => normalizeExcerpt(b.markText).length - normalizeExcerpt(a.markText).length
  )[0];
  assert(
    !excerptFitsCard(longest.markText, "portable"),
    `longest DB highlight (${normalizeExcerpt(longest.markText).length} chars) excluded from portable`
  );
  db.close();
} else {
  console.log("skip: no data/weread.db");
}

// ── elementShowsFullText (jsdom-free mock) ───────────────────────────────────
const full = { scrollHeight: 100, clientHeight: 100, clientWidth: 200 };
const clipped = { scrollHeight: 140, clientHeight: 100, clientWidth: 200 };
const unready = { scrollHeight: 100, clientHeight: 0, clientWidth: 0 };
assert(elementShowsFullText(full) === true, "full text element passes");
assert(elementShowsFullText(clipped) === false, "clipped element fails");
assert(elementShowsFullText(unready) === null, "unready layout returns null");

console.log("verify-card-excerpts PASS");
