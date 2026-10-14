import { getCustomerByAuthUserId } from "../../infrastructure/clients/customer.client.js";
import { getProductById } from "../../infrastructure/clients/product.client.js";
import { calculateOrderTotals } from "../../domain/services/discount.service.js";

function businessError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function prepareOrder({ customerAuthUserId, items }) {
  // 1. Kiểm tra khách hàng
  if (
    !Number.isSafeInteger(customerAuthUserId) ||
    customerAuthUserId <= 0
  ) {
    throw businessError(
      "Invalid customer ID",
      400,
      "INVALID_CUSTOMER_ID"
    );
  }

  // 2. Kiểm tra danh sách sản phẩm
  if (!Array.isArray(items) || items.length === 0) {
    throw businessError(
      "Order must contain at least one item",
      400,
      "INVALID_ORDER_ITEMS"
    );
  }

  const productIds = new Set();

  for (const item of items) {
    if (
      typeof item?.productId !== "string" ||
      !/^[a-fA-F0-9]{24}$/.test(item.productId) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw businessError(
        "Invalid product ID or quantity",
        400,
        "INVALID_ORDER_ITEMS"
      );
    }

    const normalizedId = item.productId.toLowerCase();

    if (productIds.has(normalizedId)) {
      throw businessError(
        "Duplicate products in order",
        400,
        "DUPLICATE_ORDER_PRODUCT"
      );
    }

    productIds.add(normalizedId);
  }

  // 3. Lấy thông tin khách hàng từ Customer Service
  const customer = await getCustomerByAuthUserId(
    customerAuthUserId
  );

  if (!customer) {
    throw businessError(
      "Customer not found",
      404,
      "CUSTOMER_NOT_FOUND"
    );
  }

  // 4. Lấy thông tin sản phẩm từ Product Service
  const orderItems = [];

  for (const item of items) {
    const product = await getProductById(item.productId);

    if (!product) {
      throw businessError(
        "Product not found",
        404,
        "PRODUCT_NOT_FOUND"
      );
    }

    if (product.status !== "ACTIVE") {
      throw businessError(
        "Product is inactive",
        409,
        "PRODUCT_INACTIVE"
      );
    }

    if (!Number.isSafeInteger(product.price) ||
        product.price < 0) {
      throw businessError(
        "Invalid product price",
        502,
        "INVALID_PRODUCT_PRICE"
      );
    }

    orderItems.push({
      productId: item.productId,
      productSku: product.sku,
      productName: product.name,
      unitPrice: product.price,
      quantity: item.quantity,
      lineTotal: product.price * item.quantity,
    });
  }

  // 5. Tính giảm giá theo hạng thành viên
  const discountPercent = Number(
    customer.discount_percent ?? 0
  );

  const totals = calculateOrderTotals(
    orderItems,
    discountPercent
  );

  return {
    customerAuthUserId,
    membershipTier: customer.membership_tier ?? null,
    ...totals,
    items: orderItems,
  };
}
