import { createHash } from "node:crypto";

export function createRequestHash({ customerAuthUserId, items }) {
  const customerId = Number(customerAuthUserId);

  if (
    !Number.isSafeInteger(customerId) ||
    customerId <= 0 ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error("Invalid order request");
  }

  const normalizedItems = items.map((item) => {
    const productId = String(item.productId || "").toLowerCase();
    const quantity = item.quantity;

    if (
      !/^[a-f0-9]{24}$/.test(productId) ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Invalid order item");
    }

    return { productId, quantity };
  });

  const productIds = normalizedItems.map((item) => item.productId);

  if (new Set(productIds).size !== productIds.length) {
    throw new Error("Duplicate products in order request");
  }

  normalizedItems.sort((a, b) =>
    a.productId.localeCompare(b.productId)
  );

  const payload = JSON.stringify({
    customerAuthUserId: customerId,
    items: normalizedItems,
  });

  return createHash("sha256")
    .update(payload)
    .digest("hex");
}
