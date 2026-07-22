import assert from "node:assert/strict";
import test from "node:test";
import { LfJsonDecoder, validateRequest } from "../src/protocol.mjs";

test("decoder splits on LF but preserves Unicode separators", () => {
  const decoder = new LfJsonDecoder();
  const values = decoder.push(Buffer.from('{"text":"a b c"}\n', "utf8"));
  assert.deepEqual(values, [{ text: "a b c" }]);
  decoder.finish();
});

test("decoder accepts CRLF and rejects truncated input", () => {
  const decoder = new LfJsonDecoder();
  assert.deepEqual(decoder.push(Buffer.from('{"ok":true}\r\n')), [{ ok: true }]);
  decoder.push(Buffer.from("{"));
  assert.throws(() => decoder.finish(), /truncated/);
});

test("request validation rejects missing identifiers", () => {
  assert.throws(() => validateRequest({ action: "models.list" }), /id/);
  assert.deepEqual(validateRequest({ id: "1", action: "models.list" }), {
    id: "1",
    action: "models.list",
    params: {},
  });
});
