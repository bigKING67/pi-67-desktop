export interface RuntimeQueueClearResult {
  steeringCount: number;
  followUpCount: number;
}

interface SessionQueueControl {
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): unknown;
}

export function clearSessionQueue(session: SessionQueueControl): RuntimeQueueClearResult {
  const result = {
    steeringCount: session.getSteeringMessages().length,
    followUpCount: session.getFollowUpMessages().length
  };
  session.clearQueue();
  return result;
}
