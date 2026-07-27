const restartWindowMilliseconds = 60_000;
const maximumRestarts = 3;

export type AgentHostRestartPlan =
  | { history: number[]; recoverable: false }
  | { history: number[]; recoverable: true; attempt: number; delay: number };

export function planAgentHostRestart(history: readonly number[], now: number): AgentHostRestartPlan {
  const recentHistory = history.filter((timestamp) => now - timestamp < restartWindowMilliseconds);
  if (recentHistory.length >= maximumRestarts) return { history: recentHistory, recoverable: false };

  const updatedHistory = [...recentHistory, now];
  const attempt = updatedHistory.length;
  return {
    history: updatedHistory,
    recoverable: true,
    attempt,
    delay: Math.min(4_000, 500 * 2 ** (attempt - 1))
  };
}
