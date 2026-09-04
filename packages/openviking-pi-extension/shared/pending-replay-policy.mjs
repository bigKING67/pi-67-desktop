export function operationPriority(type) {
  if (type === "createSession") return 0;
  if (type === "addMessage") return 1;
  if (type === "commitSession") return 2;
  return 3;
}

const REMOTE_IDENTITY_TOKEN_BUDGET = 128_000;

export async function remoteOperationState(fetchJSON, entry) {
  if (entry.type === "createSession") return remoteSessionState(fetchJSON, entry.sessionId);
  if (entry.type === "addMessage") return remoteMessageState(fetchJSON, entry);
  return { known: true, present: false };
}

async function remoteSessionState(fetchJSON, sessionId) {
  let response;
  try {
    response = await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  } catch {
    return { known: false, present: false };
  }
  if (response?.ok) return { known: true, present: true };
  return response?.status === 404
    ? { known: true, present: false }
    : { known: false, present: false };
}

async function remoteMessageState(fetchJSON, entry) {
  const expected = Array.isArray(entry.payload?.source_message_ids)
    ? entry.payload.source_message_ids.filter((value) => typeof value === "string" && value)
    : [];
  if (expected.length === 0) return { known: true, present: false };
  let response;
  try {
    response = await fetchJSON(
      `/api/v1/sessions/${encodeURIComponent(entry.sessionId)}/context?token_budget=${REMOTE_IDENTITY_TOKEN_BUDGET}`,
    );
  } catch {
    return { known: false, present: false };
  }
  if (!response?.ok) {
    return response?.status === 404
      ? { known: true, present: false }
      : { known: false, present: false };
  }
  const messages = Array.isArray(response.result?.messages) ? response.result.messages : [];
  return {
    known: true,
    present: messages.some((message) => {
      const remoteIds = Array.isArray(message?.source_message_ids) ? message.source_message_ids : [];
      return expected.some((sourceId) => remoteIds.includes(sourceId));
    }),
  };
}
