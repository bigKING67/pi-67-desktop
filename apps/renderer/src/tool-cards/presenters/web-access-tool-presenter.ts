import type { ToolPresenter } from "../tool-presentation.js";
import {
  boundToolText,
  compactToolDetails,
  compactToolText,
  matchesToolName,
  normalizeToolSummary,
  parseToolSummaryFields,
  readToolSummaryTextArrayField,
  readToolSummaryTextField
} from "../tool-presentation-boundaries.js";

const WEB_ACCESS_TOOLS = [
  "web_search",
  "get_search_content",
  "fetch_content",
  "source_check"
] as const;

type WebAccessTool = typeof WEB_ACCESS_TOOLS[number];

export const webAccessToolPresenter: ToolPresenter = {
  id: "web-access",
  matches: (tool) => matchesToolName(tool.name, WEB_ACCESS_TOOLS),
  present(tool) {
    const mode = webAccessMode(tool.name);
    const summary = normalizeToolSummary(tool.summary);
    const fields = parseToolSummaryFields(tool.summary);
    const query = readToolSummaryTextField(fields, ["query", "search"]);
    const queries = readToolSummaryTextArrayField(fields, ["queries"]);
    const claim = readToolSummaryTextField(fields, ["claim"]);
    const url = readToolSummaryTextField(fields, ["url"]);
    const urls = readToolSummaryTextArrayField(fields, ["urls"]);
    const responseId = readToolSummaryTextField(fields, ["responseId", "response_id"]);
    const targets = compactTargets(
      mode === "web_search"
        ? query ? [query] : queries
        : mode === "get_search_content"
          ? query ? [query] : url ? [url] : []
          : mode === "fetch_content"
            ? url ? [url] : urls
            : claim ? [claim] : query ? [query] : url ? [url] : []
    );

    return {
      presenterId: "web-access",
      kind: "read",
      title: webAccessTitle(mode),
      compact: compactToolText(targets, "已提交参数"),
      details: compactToolDetails([
        claim ? { label: "待核对内容", value: claim } : undefined,
        query ? { label: "搜索条件", value: query } : undefined,
        queries.length > 0 ? { label: "搜索条件", value: detailTargets(queries) } : undefined,
        url ? { label: "网页", value: url } : undefined,
        urls.length > 0 ? { label: "网页", value: detailTargets(urls) } : undefined,
        responseId ? { label: "响应 ID", value: responseId } : undefined
      ]),
      limitations: ["参数与结果来自有界且脱敏的 Pi Session 投影。"],
      ...(summary ? { summary } : {})
    };
  }
};

function webAccessMode(name: string): WebAccessTool {
  return WEB_ACCESS_TOOLS.find((candidate) => matchesToolName(name, [candidate]))
    ?? "web_search";
}

function webAccessTitle(mode: WebAccessTool): string {
  switch (mode) {
    case "web_search": return "搜索内容";
    case "get_search_content": return "获取搜索内容";
    case "fetch_content": return "读取网页";
    case "source_check": return "核对来源";
  }
}

function compactTargets(values: readonly string[]): string | undefined {
  const first = values[0];
  if (!first) return undefined;
  return values.length > 1 ? `${first} · 等 ${values.length} 项` : first;
}

function detailTargets(values: readonly string[]): string {
  return boundToolText(values.join("\n"), 3_200);
}
