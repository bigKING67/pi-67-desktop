export function validateTrustedImeSubmissionEvidence({
  composerValue,
  events,
  eventsBeforeSecondEnter,
  probe
}) {
  const candidateConfirmation = events
    .slice(0, eventsBeforeSecondEnter)
    .find((event) => event.isTrusted && (event.isComposing || event.keyCode === 229));
  const secondEnter = events
    .slice(eventsBeforeSecondEnter)
    .find((event) => event.isTrusted && !event.isComposing && event.keyCode !== 229);
  if (!candidateConfirmation) {
    throw new Error("No trusted Microsoft Pinyin candidate-confirmation Enter was observed.");
  }
  if (!secondEnter) throw new Error("No trusted post-composition Enter was observed.");
  if (probe?.activeOperationId === undefined
    || probe?.requestCount !== 1
    || probe?.responseCount !== 1
    || probe?.acceptedCount !== 1
    || probe?.textMatches !== true
    || probe?.delivery !== "follow-up"
    || probe?.operationIdMatches !== true) {
    throw new Error("Microsoft Pinyin second Enter was not accepted exactly once by the active Operation.");
  }
  if (composerValue !== "") {
    throw new Error("Composer was not cleared after the trusted Microsoft Pinyin submission was accepted.");
  }
  return {
    candidateConfirmation,
    secondEnter,
    acceptedExactlyOnce: true,
    delivery: probe.delivery,
    operationIdMatches: true,
    composerClearedAfterAccepted: true
  };
}

export function validateNativePowerResumeEvidence({
  events,
  markerStartedAt,
  operationStillActive,
  projectionRecovered
}) {
  const suspend = events.find((event) => event.type === "suspend" && event.at >= markerStartedAt);
  const resume = events.find((event) => event.type === "resume" && event.at >= (suspend?.at ?? Infinity));
  if (!suspend || !resume || resume.at <= suspend.at) {
    throw new Error("Windows native certification did not observe an ordered suspend/resume pair.");
  }
  if (resume.at - suspend.at < 1_000) {
    throw new Error("Windows native certification suspend/resume gap is too short to prove sleep.");
  }
  if (!projectionRecovered || !operationStillActive) {
    throw new Error("Pi projection or active Operation did not recover after Windows resume.");
  }
  return {
    observed: true,
    suspendAt: suspend.at,
    resumeAt: resume.at,
    sleepGapMs: resume.at - suspend.at,
    projectionRecovered: true,
    operationStillActive: true
  };
}
