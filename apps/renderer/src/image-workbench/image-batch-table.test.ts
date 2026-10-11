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

  it("explains a table it cannot use", () => {
    expect(batchTable(document, parseTable("名称\n夏日")).problem).toMatch(/表头没有对上/u);
    expect(batchTable(document, parseTable("price")).problem).toBe("表格里没有可用的行。");
    expect(batchTable(document, [["price"], ...Array.from({ length: 201 }, (_, index) => [String(index)])]).problem).toMatch(/最多 200 行/u);
  });
});
