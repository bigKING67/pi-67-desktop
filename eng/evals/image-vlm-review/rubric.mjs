// The fixed rubric a judge answers per poster, in two orders, and the parser for its JSON answer.
import { createHash } from "node:crypto";

/** One question per defect; `problem` means the poster has that defect. */
export const RUBRIC = [
  { id: "text_covered", question: "Is any text partly covered or hidden by another element?" },
  { id: "text_clipped", question: "Does any text run off the edge of the image?" },
  { id: "wrong_price", question: "Does the price shown differ from the brief's price?" },
  { id: "low_contrast", question: "Is any text too faint to read against what is behind it?" },
  { id: "misaligned", question: "Do text blocks that should share a left edge start at different x positions?" },
  { id: "product_cropped", question: "Is the product cut off by the edge of the image?" },
  { id: "seam", question: "Is there a visible seam or hard edge where the background looks stitched together?" }
];
const VERDICTS = ["problem", "ok", "unsure"];

/** The rubric in `order` ("forward" or "reverse"), so position bias shows as answers that flip. */
export function rubricItems(order) {
  return order === "reverse" ? [...RUBRIC].reverse() : [...RUBRIC];
}

/** The prompt for one poster; the brief gives what the text should say. */
export function rubricPrompt(brief, order) {
  // Unnumbered: a judge that answers by number would mean different questions in the two orders.
  const items = rubricItems(order).map((item) => `- ${item.id}: ${item.question}`).join("\n");
  return [
    "You review a marketing poster image for production defects. Judge only what you see.",
    `Brief: headline "${brief.headline}", price "${brief.price}".`,
    "Answer each question with verdict problem, ok or unsure, and for problem the region as [x, y, width, height] in image pixels (800×1000), else null.",
    items,
    'Reply with JSON only: {"items":[{"id":"<id>","verdict":"problem|ok|unsure","region":[x,y,w,h]|null}]} with one entry per id, using the ids exactly as written above (for example "seam").'
  ].join("\n\n");
}

/** A stable hash of the rubric text, recorded with each report so runs on different rubrics are not compared. */
export function rubricHash() {
  return createHash("sha256").update(JSON.stringify([RUBRIC, rubricPrompt({ headline: "-", price: "-" }, "forward")])).digest("hex").slice(0, 16);
}

/** Every `{…}` span that parses as JSON, the last first (a reply's answer usually ends it); fenced blocks included. */
function jsonCandidates(reply) {
  const found = [];
  for (let start = reply.indexOf("{"); start >= 0; start = reply.indexOf("{", start + 1)) {
    for (let end = reply.lastIndexOf("}"); end > start; end = reply.lastIndexOf("}", end - 1)) {
      try { found.push(JSON.parse(reply.slice(start, end + 1))); break; } catch { /* try a shorter span */ }
    }
  }
  return found.reverse();
}

/**
 * The verdict per rubric id from a judge's reply. A reply is parsed only when one JSON object in
 * it gives a valid verdict for every rubric id; otherwise every verdict is `unsure` and the
 * reply is reported as unparsed.
 */
export function parseAnswer(reply) {
  const unsure = Object.fromEntries(RUBRIC.map((item) => [item.id, "unsure"]));
  for (const value of jsonCandidates(reply)) {
    const items = Array.isArray(value?.items) ? value.items : [];
    const verdicts = { ...unsure }, seen = new Set();
    for (const item of items) {
      if (typeof item?.id === "string" && Object.hasOwn(verdicts, item.id) && VERDICTS.includes(item.verdict)) { verdicts[item.id] = item.verdict; seen.add(item.id); }
    }
    if (seen.size === RUBRIC.length) return { parsed: true, verdicts };
  }
  return { parsed: false, verdicts: unsure };
}
