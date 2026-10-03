import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  for (const name of ["sample.json", "sample-claim-reviewed.json"]) {
    const sample = JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
    assert.deepEqual(validateEvent(sample), [], `${name} 应通过校验`);
  }
});
