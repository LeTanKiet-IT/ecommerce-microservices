export function calculateOrderTotals(items, discountPercent) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Order must contain at least one item");
  }

  const percent = Number(discountPercent);

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error("Invalid discount percent");
  }

  let subtotal = 0;

  for (const item of items) {
    const price = Number(item.unitPrice);
    const quantity = Number(item.quantity);

    if (
      !Number.isSafeInteger(price) ||
      price < 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Invalid product price or quantity");
    }

    const lineTotal = price * quantity;

    if (!Number.isSafeInteger(lineTotal)) {
      throw new Error("Order amount exceeds safe limit");
    }

    subtotal += lineTotal;

    if (!Number.isSafeInteger(subtotal)) {
      throw new Error("Order subtotal exceeds safe limit");
    }
  }

  const percentBasisPoints = Math.round(percent * 100);

  const discountAmount = Math.round(
    (subtotal * percentBasisPoints) / 10000
  );

  const totalAmount = subtotal - discountAmount;

  return {
    subtotal,
    discountPercent: percentBasisPoints / 100,
    discountAmount,
    totalAmount,
  };
}
