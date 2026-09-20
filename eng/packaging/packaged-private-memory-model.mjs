import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { packagedTeamModelTurn } from "./packaged-team-model-turn.mjs";

/** Offline OpenAI-compatible fixture. No forwarding, provider secrets or bodies in logs. */
export async function startPrivateMemoryModel({ teamNative = false, tls } = {}) {
  if (teamNative && !tls) throw new Error("Native team model fixture requires explicit TLS");
  const counts = { agent: 0, embedding: 0, extraction: 0, rejected: 0 };
  const evidence = { preferenceExtractions: 0, summaries: 0, recalledPreference: false };
  const teamEvidence = { searchRequests: 0, readRequests: 0, exactBody: false };
  const handleRequest = async (request, response) => {
    try {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error("Oversized fixture request");
      }
      const body = JSON.parse(raw);
      if (request.headers.authorization !== "Bearer synthetic-memory-only") throw new Error("Unexpected fixture credential");
      if (request.url === "/v1/embeddings" && body.model === "embedding") {
        counts.embedding++;
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ object: "list", model: "embedding", data: inputs.map((_, index) => ({
          object: "embedding", index, embedding: [1, 0, 0, 0, 0, 0, 0, 0]
        })), usage: { prompt_tokens: 1, total_tokens: 1 } })); return;
      }
      const messages = JSON.stringify(body.messages);
      if (request.url === "/v1/chat/completions" && body.model === "extract" && !body.stream) {
        let content;
        if (messages.includes("## Page ID Rules") && messages.includes("NM-PACKAGED-PRIVATE-ONE")) {
          evidence.preferenceExtractions++;
          content = JSON.stringify({ preferences: [{ page_id: 100, user: "desktop", topic: "communication_style",
            content: "- NM-PACKAGED-PRIVATE-ONE: Prefers concise Chinese responses." }], delete_ids: [] });
        } else if (messages.includes("You are a session note-taker") && messages.includes("NM-PACKAGED-PRIVATE-ONE")) {
          evidence.summaries++;
          content = "# Working Memory\n\n## Current State\nPrivate fixture completed.\n\n## Key Facts & Decisions\nPrefers concise Chinese responses.";
        } else throw new Error("Unexpected extraction purpose");
        counts.extraction++;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id: "synthetic-extraction", object: "chat.completion", created: 1, model: "extract",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return;
      }
      if (request.url !== "/v1/chat/completions" || body.model !== "agent" || !body.stream) {
        if (body.model === "extract") counts.extraction++;
        throw new Error("Unexpected fixture model operation");
      }
      counts.agent++;
      // Semantic title generation shares this model; request count is not turn identity.
      const fixtureTurn = messages.includes("NM-PACKAGED-RECALL") ? 3 : messages.includes("NM-PACKAGED-PRIVATE-TWO") ? 2 : 1;
      if (fixtureTurn === 3 && messages.includes("NM-PACKAGED-PRIVATE-ONE")
        && messages.includes("/memories/preferences/desktop/communication_style.md")) evidence.recalledPreference = true;
      response.setHeader("content-type", "text/event-stream");
      const chunk = (delta, finish_reason = null) => ({ id: "synthetic-completion", object: "chat.completion.chunk",
        created: 1, model: "agent", choices: [{ index: 0, delta, finish_reason }] });
      const team = teamNative ? packagedTeamModelTurn(body, teamEvidence) : undefined;
      if (team) {
        response.write(`data: ${JSON.stringify(chunk(team.delta))}\n\n`);
        response.write(`data: ${JSON.stringify(chunk({}, team.finish))}\n\n`);
        response.end("data: [DONE]\n\n"); return;
      }
      response.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: `本地私人记忆合成回复 ${fixtureTurn}。` }))}\n\n`);
      response.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch {
      counts.rejected++;
      if (!response.headersSent) response.writeHead(400, { "content-type": "application/json" });
      response.end('{"error":{"message":"Synthetic fixture request rejected"}}');
    }
  };
  const server = tls ? createSecureServer(tls, handleRequest) : createServer(handleRequest);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { endpoint: `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}/v1`, counts, evidence, teamEvidence,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
