import assert from "node:assert/strict";
import { test } from "node:test";
import { validate } from "../src/schema.ts";

test("const and enum compare JSON values rather than decoded object identity", () => {
  const records = [["record_1", 12], ["record_2", 17]];
  assert.deepEqual(validate({ const: records }, JSON.parse(JSON.stringify(records))), []);
  assert.ok(validate({ const: records }, [["/record_1", 12], ["record_2", 17]]).length);
  assert.ok(validate({ const: records }, [["record_1", "12"], ["record_2", 17]]).length);
  assert.deepEqual(validate({ enum: [{ a: 1, b: [true, null] }] }, { b: [true, null], a: 1 }), []);
  assert.ok(validate({ enum: [{ a: 1 }] }, { a: 1, b: 2 }).length);
  assert.ok(validate({ const: [1, 2] }, [2, 1]).length);
  assert.ok(validate({ const: null }, undefined).length);
});
