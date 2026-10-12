import { IMAGE_BATCH_LIMITS, type ImageDocument } from "@pi67/domain";

// P5 checkpoint 1: a CSV table for a batch, read in the renderer (no file path ever leaves
// it). Columns are matched to text layers by the person's choice for that header, else by layer
// id or by the layer's current words; each non-empty row becomes the words of the matched
// layers in one variant.

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
  /**
   * Every named column, in table order: its header, the key a choice is kept under (the header,
   * or `header#2` for its second use), and the text layer it fills, if any.
   */
  columns: { key: string; column: string; layer?: string }[];
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

/** What the person chose per column key: a text layer id, or "" for a column not to use. */
export type BatchColumnChoices = Readonly<Record<string, string>>;

/**
 * Matches the header to the document's text layers and turns the data rows into batch rows. The
 * person's choices are applied first, so a chosen layer is never taken by an automatic match;
 * the rest match by id or by current words. One layer fills at most one column.
 */
export function batchTable(document: ImageDocument, table: readonly string[][], choices: BatchColumnChoices = {}): BatchTable {
  const [header = [], ...data] = table;
  const texts = document.objects.filter((object) => object.kind === "text");
  const seen = new Map<string, number>();
  const keyed = header.map((raw, index) => {
    const column = raw.trim(), count = (seen.get(column) ?? 0) + 1;
    seen.set(column, count);
    return { index, column, key: count > 1 ? `${column}#${count}` : column };
  });
  const taken = new Map<number, string>(), used = new Set<string>();
  // First the person's choices (a layer still a text layer), then the automatic matches.
  for (const { index, key } of keyed) {
    const layer = Object.hasOwn(choices, key) && choices[key] !== "" ? texts.find((object) => object.id === choices[key]) : undefined;
    if (layer && !used.has(layer.id)) { taken.set(index, layer.id); used.add(layer.id); }
  }
  for (const { index, column, key } of keyed) {
    if (taken.has(index) || !column || Object.hasOwn(choices, key)) continue;
    const byId = texts.filter((object) => object.id === column), byWords = texts.filter((object) => object.text.trim() === column);
    const layer = byId.length === 1 ? byId[0] : byWords.length === 1 ? byWords[0] : undefined;
    if (layer && !used.has(layer.id)) { taken.set(index, layer.id); used.add(layer.id); }
  }
  const matched = keyed.flatMap(({ index }) => taken.has(index) ? [{ index, layer: taken.get(index)! }] : []);
  const unmatched = keyed.filter(({ index }) => !taken.has(index)).map(({ index, column }) => column || `第 ${index + 1} 列`);
  const columns = keyed.filter(({ column }) => column).map(({ index, column, key }) => ({ key, column, ...(taken.has(index) ? { layer: taken.get(index)! } : {}) }));
  const numbered = data.map((cells, index) => ({ row: index + 1, texts: matched.flatMap(({ index: column, layer }) => {
    const value = cells[column] ?? "";
    return value.trim() === "" ? [] : [{ layer, text: value }];
  }) }));
  const rows = numbered.filter((entry) => entry.texts.length > 0), skipped = numbered.filter((entry) => !entry.texts.length).map((entry) => entry.row);
  const named = matched.map((item) => ({ column: header[item.index]!.trim(), layer: item.layer }));
  const problem = !columns.length ? "表格第一行要写表头（每列一个名字）。"
    : !named.length ? "还没有列对上文字图层：在上面为要用的列选对应的图层。"
    : !rows.length ? "表格里没有可用的行。"
    : data.length > IMAGE_BATCH_LIMITS.rows ? `一批最多 ${IMAGE_BATCH_LIMITS.rows} 行，这张表有 ${data.length} 行。`
    : named.length > IMAGE_BATCH_LIMITS.texts ? `一行最多改 ${IMAGE_BATCH_LIMITS.texts} 个文字图层。`
    : rows.some((entry) => entry.texts.some((cell) => cell.text.length > IMAGE_BATCH_LIMITS.characters)) ? `单元格最多 ${IMAGE_BATCH_LIMITS.characters} 个字。`
    : undefined;
  return { columns, matched: named, unmatched, rows, skipped, ...(problem ? { problem } : {}) };
}
