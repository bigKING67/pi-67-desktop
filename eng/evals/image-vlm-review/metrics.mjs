// Scores judge answers against the golden labels. A verdict counts only when both rubric orders
// agree; one that flips with the order is unstable and never counts as a hit.
import { RUBRIC } from "./rubric.mjs";

/**
 * `answers`: [{ model, caseId, defect, order: "forward"|"reverse", parsed, verdicts }]. Returns per
 * model: per rubric item the hit rate on posters with that defect (an unparsed pair is a miss),
 * the false-alarm rate on the rest, and how often it flipped among readable pairs; the clean
 * posters' false-alarm rate; flips, and unparsed replies and posters.
 */
export function scoreAnswers(answers) {
  const models = [...new Set(answers.map((answer) => answer.model))];
  return models.map((model) => {
    const mine = answers.filter((answer) => answer.model === model);
    const posters = [...new Set(mine.map((answer) => answer.caseId))].map((caseId) => {
      const forward = mine.find((answer) => answer.caseId === caseId && answer.order === "forward");
      const reverse = mine.find((answer) => answer.caseId === caseId && answer.order === "reverse");
      const defect = (forward ?? reverse).defect;
      // A pair with an unreadable or missing side is unparsed, not unstable: it says nothing about order.
      const readable = forward?.parsed === true && reverse?.parsed === true;
      const verdicts = Object.fromEntries(RUBRIC.map(({ id }) => {
        const a = forward?.verdicts[id], b = reverse?.verdicts[id];
        return [id, !readable ? "unparsed" : a === b ? a : "unstable"];
      }));
      return { caseId, defect, verdicts };
    });
    const items = RUBRIC.map(({ id }) => {
      const positive = posters.filter((poster) => poster.defect === id), negative = posters.filter((poster) => poster.defect !== id);
      return {
        id,
        positives: positive.length,
        hitRate: rate(positive.filter((poster) => poster.verdicts[id] === "problem").length, positive.length),
        // Posters without a verdict on this question (unparsed, flipped) are neither hits nor clean passes.
        falseAlarmRate: rate(negative.filter((poster) => poster.verdicts[id] === "problem").length, negative.filter((poster) => hasVerdict(poster.verdicts[id])).length),
        noVerdict: posters.filter((poster) => !hasVerdict(poster.verdicts[id])).length,
        unstableRate: rate(posters.filter((poster) => poster.verdicts[id] === "unstable").length, posters.filter((poster) => poster.verdicts[id] !== "unparsed").length)
      };
    });
    const clean = posters.filter((poster) => poster.defect === "none");
    const readable = posters.filter((poster) => !Object.values(poster.verdicts).includes("unparsed"));
    const pairs = readable.length * RUBRIC.length;
    return {
      model,
      posters: posters.length,
      items,
      cleanFalseAlarmRate: rate(clean.filter((poster) => Object.values(poster.verdicts).includes("problem")).length, clean.filter((poster) => Object.values(poster.verdicts).every(hasVerdict)).length),
      unparsedPosters: posters.length - readable.length,
      unstableRate: rate(readable.reduce((sum, poster) => sum + Object.values(poster.verdicts).filter((verdict) => verdict === "unstable").length, 0), pairs),
      unparsed: mine.filter((answer) => !answer.parsed).length
    };
  });
}

const hasVerdict = (verdict) => verdict !== "unparsed" && verdict !== "unstable";
const rate = (count, total) => total ? Math.round((count / total) * 1000) / 1000 : null;
