// The Markdown report of one run: what was judged, by whom, at what cost, and how well.
import { RUBRIC } from "./rubric.mjs";

const percent = (value) => value === null ? "—" : `${Math.round(value * 100)}%`;

export function renderReport({ date, runId, rubricHash, posters, models, scores, spend, notes = [] }) {
  const lines = [
    `# Image VLM review eval — ${date}`,
    "",
    "Plan: `docs/plans/2026-10-11-image-vlm-eval.md`. Every answer is an observation (`UNVERIFIED`);",
    "nothing here approves or blocks an image. A verdict counts only when both rubric orders agree;",
    "an unparsed or flipped answer is a miss on its poster and is left out of the false-alarm rates.",
    "Only the yes/no verdict is scored: where the judge says the problem is (its region) is not checked.",
    "",
    `- Golden posters: ${posters} (synthetic, engine-rendered; one known defect or none)`,
    `- Rubric: ${RUBRIC.length} questions, hash \`${rubricHash}\`, asked in forward and reverse order`,
    `- Judges: ${models.map((model) => `\`${model}\``).join(", ")}`,
    `- Run: \`${runId}\``,
    `- Estimated spend: ¥${spend.run.toFixed(2)} this run, ¥${spend.total.toFixed(2)} across all runs (conservative list prices; cap ¥30)`,
    ""
  ];
  for (const score of scores) {
    lines.push(`## ${score.model}`, "",
      `Clean posters with any false alarm: ${percent(score.cleanFalseAlarmRate)} · answers that flip with order (readable pairs): ${percent(score.unstableRate)} · unparsed replies: ${score.unparsed} (posters left unscored: ${score.unparsedPosters}, counted as misses)`, "",
      "| Question | Posters with it | Hit rate | False alarms elsewhere | Flips | No verdict |", "| --- | --- | --- | --- | --- | --- |",
      ...score.items.map((item) => `| \`${item.id}\` | ${item.positives} | ${percent(item.hitRate)} | ${percent(item.falseAlarmRate)} | ${percent(item.unstableRate)} | ${item.noVerdict} |`), "");
  }
  if (notes.length) lines.push("## Notes", "", ...notes.map((note) => `- ${note}`), "");
  return `${lines.join("\n")}\n`;
}
