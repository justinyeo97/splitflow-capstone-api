import test from "node:test";
import assert from "node:assert/strict";
import { decimal, multiplyAndRound } from "../src/utils/money.js";

test("decimal parser preserves fixed precision", () => {
  assert.equal(decimal("123.45000001").toString(), "12345000001");
  assert.throws(() => decimal("1.123456789"), /Maximum precision/);
});

test("conversion rounds half away from zero to cents", () => {
  assert.equal(multiplyAndRound("10.25", "1.12345678"), "11.52");
  assert.equal(multiplyAndRound("2.00", "0.00500000"), "0.01");
  assert.equal(multiplyAndRound("100.00", "1.123456789123"), "112.35");
  assert.equal(multiplyAndRound("0.00", "1.00000000"), "0.00");
});
