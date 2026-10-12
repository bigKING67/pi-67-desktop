import type { ImageDocument } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { batchTable, parseTable } from "./image-batch-table.js";

const text = (id: string, words: string) => ({ id, kind: "text", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, text: words, font_size: 20, color: "#000000", align: "left", line_height: 1.2 });
const document = { objects: [text("title", "春日茶礼"), text("price", "¥199"), text("a", "同"), text("b", "同")] } as unknown as ImageDocument;

describe("batch tables", () => {
  it("reads quoted CSV with a BOM, CRLF, doubled quotes and newlines in cells, and tab-separated tables", () => {
    expect(parseTable("\uFEFFtitle,price\r\n\"夏日, 冷萃\",\"¥2\"\"99\"\r\n\"两\n行\",¥3\r\n\r\n")).toEqual([["title", "price"], ["夏日, 冷萃", "¥2\"99"], ["两\n行", "¥3"]]);
    expect(parseTable("title\tprice\n夏日\t¥299")).toEqual([["title", "price"], ["夏日", "¥299"]]);
    // A tab-separated header whose words hold a comma is still read by tabs.
    expect(parseTable("¥1,299\t标题\n¥1,399\t夏日")).toEqual([["¥1,299", "标题"], ["¥1,399", "夏日"]]);
  });

  it("matches columns by layer id or current words, leaves ambiguous ones out and keeps empty cells as they are", () => {
    const table = batchTable(document, parseTable("¥199,title,同,备注\n¥299,夏日,x,y\n,秋日,,\n,,,z"));
    expect(table.matched).toEqual([{ column: "¥199", layer: "price" }, { column: "title", layer: "title" }]);
    expect(table.unmatched).toEqual(["同", "备注"]);
    expect(table.rows).toEqual([{ row: 1, texts: [{ layer: "price", text: "¥299" }, { layer: "title", text: "夏日" }] }, { row: 2, texts: [{ layer: "title", text: "秋日" }] }]);
    // The third data row changes nothing: it is skipped, and later rows keep their numbers.
    expect(table.skipped).toEqual([3]);
    expect(table.problem).toBeUndefined();
  });

  it("lets the person choose a column's layer, or not to use it, over the automatic match", () => {
    const table = parseTable("价格,标题,¥199\n¥99,夏日,¥1\n");
    // Plain headers match nothing on their own; the words header does.
    expect(batchTable(document, table).columns).toEqual([{ key: "价格", column: "价格" }, { key: "标题", column: "标题" }, { key: "¥199", column: "¥199", layer: "price" }]);
    const chosen = batchTable(document, table, { 价格: "price", 标题: "title", "¥199": "" });
    expect(chosen.columns.map((column) => column.layer)).toEqual(["price", "title", undefined]);
    expect(chosen.rows).toEqual([{ row: 1, texts: [{ layer: "price", text: "¥99" }, { layer: "title", text: "夏日" }] }]);
    // A choice wins over an automatic match of another column: ¥199 no longer takes the price layer.
    expect(batchTable(document, table, { 价格: "price" }).columns.map((column) => column.layer)).toEqual(["price", undefined, undefined]);
    // A choice naming a layer that is gone falls back to the automatic match.
    expect(batchTable(document, table, { 价格: "gone" }).columns[0]).toEqual({ key: "价格", column: "价格" });
    // A header used twice gets its own key, so each column is chosen apart.
    const twice = batchTable(document, parseTable("标题,标题\na,b\n"), { 标题: "title", "标题#2": "price" });
    expect(twice.columns).toEqual([{ key: "标题", column: "标题", layer: "title" }, { key: "标题#2", column: "标题", layer: "price" }]);
    // A first row of empty cells is no header.
    expect(batchTable(document, [["", " "], ["a", "b"]]).problem).toMatch(/第一行要写表头/u);
  });

  it("explains a table it cannot use", () => {
    expect(batchTable(document, parseTable("名称\n夏日")).problem).toMatch(/还没有列对上文字图层/u);
    expect(batchTable(document, parseTable("price")).problem).toBe("表格里没有可用的行。");
    expect(batchTable(document, [["price"], ...Array.from({ length: 201 }, (_, index) => [String(index)])]).problem).toMatch(/最多 200 行/u);
  });
});
