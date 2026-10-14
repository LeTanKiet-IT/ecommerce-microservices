import assert from "node:assert/strict";
import { createRequestHash } from "./src/application/use-cases/request-hash.js";

const a = "6ace8d5dc8c1450fa32654a1";
const b = "aaaaaaaaaaaaaaaaaaaaaaaa";

const first = createRequestHash({
  customerAuthUserId: 1,
  items: [
    { productId: a, quantity: 2 },
    { productId: b, quantity: 1 },
  ],
});

const sameCart = createRequestHash({
  customerAuthUserId: 1,
  items: [
    { productId: b, quantity: 1 },
    { productId: a, quantity: 2 },
  ],
});

const differentCart = createRequestHash({
  customerAuthUserId: 1,
  items: [
    { productId: a, quantity: 5 },
    { productId: b, quantity: 1 },
  ],
});

assert.equal(first, sameCart);
console.log("PASS: Same cart produces same hash");

assert.notEqual(first, differentCart);
console.log("PASS: Different quantity produces different hash");

assert.equal(first.length, 64);
console.log("PASS: SHA-256 hash has 64 characters");

assert.throws(() =>
  createRequestHash({
    customerAuthUserId: 1,
    items: [
      { productId: a, quantity: 1 },
      { productId: a, quantity: 2 },
    ],
  })
);
console.log("PASS: Duplicate products rejected");

console.log("ALL TESTS PASSED");
