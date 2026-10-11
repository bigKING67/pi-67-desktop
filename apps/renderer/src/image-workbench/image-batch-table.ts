import { IMAGE_BATCH_LIMITS, type ImageDocument } from "@pi67/domain";

// P5 checkpoint 1: a CSV table for a batch, read in the renderer (no file path ever leaves
// it). Columns are matched to text layers by layer id or by the layer's current words; each
// non-empty row becomes the words of the matched layers in one variant.

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF), UTF-8 with or without BOM; tab-separated when the header has a tab. */
export function parseTable(source: string): string[][] {
  const text = source.replace(/^\uFEFF/u, "");
  const header = text.slice(0, text.search(/\r?\n|$/u));
  // Tabs win: a header of current words may hold commas (`¥1,299`), but a CSV header rarely holds a tab.
  const separator = header.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") { field += "\""; index++; }
      else if (char === "\"") quoted = false;
      else field += char;
    } else if (char === "\"" && field === "") quoted = true;
    else if (char === separator) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export interface BatchTable {
  /** Columns that name a text layer, in table order. */
  matched: { column: string; layer: string }[];
  /** Headers that name no text layer (or several), left out. */
  unmatched: string[];
  /**
   * One entry per data row with something to change, numbered as in the table (1 = the first
   * row under the header); an empty cell keeps the layer's current words.
   */
  rows: { row: number; texts: { layer: string; text: string }[] }[];
  /** Table rows whose matched cells are all empty: nothing to change, so not run. */
  skipped: number[];
  /** Why the table cannot be used as it is, in product words. */
  problem?: string;
}

/** Matches the header to the document's text layers and turns the data rows into batch rows. */
export function batchTable(document: ImageDocument, table: readonly string[][]): BatchTable {
  const [header = [], ...data] = table;
  const texts = document.objects.filter((object) => object.kind === "text");
  const matched: { index: number; layer: string }[] = [], unmatched: string[] = [];
  for (const [index, raw] of header.entries()) {
    const column = raw.trim();
    const byId = texts.filter((object) => object.id === column), byWords = texts.filter((object) => object.text.trim() === column);
    const layer = byId.length === 1 ? byId[0] : byWords.length === 1 ? byWords[0] : undefined;
    if (layer && !matched.some((item) => item.layer === layer.id)) matched.push({ index, layer: layer.id });
    else unmatched.push(column || `第 ${index + 1} 列`);
  }
  const numbered = data.map((cells, index) => ({ row: index + 1, texts: matched.flatMap(({ index: column, layer }) => {
    const value = cells[column] ?? "";
    return value.trim() === "" ? [] : [{ layer, text: value }];
  }) }));
  const rows = numbered.filter((entry) => entry.texts.length > 0), skipped = numbered.filter((entry) => !entry.texts.length).map((entry) => entry.row);
  const named = matched.map((item) => ({ column: header[item.index]!.trim(), layer: item.layer }));
  const problem = !named.length ? "表头没有对上任何文字图层：第一行写图层名（如 price）或它现在的文字（如 ¥199）。"
    : !rows.length ? "表格里没有可用的行。"
    : data.length > IMAGE_BATCH_LIMITS.rows ? `一批最多 ${IMAGE_BATCH_LIMITS.rows} 行，这张表有 ${data.length} 行。`
    : named.length > IMAGE_BATCH_LIMITS.texts ? `一行最多改 ${IMAGE_BATCH_LIMITS.texts} 个文字图层。`
    : rows.some((entry) => entry.texts.some((cell) => cell.text.length > IMAGE_BATCH_LIMITS.characters)) ? `单元格最多 ${IMAGE_BATCH_LIMITS.characters} 个字。`
    : undefined;
  return { matched: named, unmatched, rows, skipped, ...(problem ? { problem } : {}) };
}
