import { prepareOrder } from "./src/application/use-cases/create-order.use-case.js";

const productId = "6ace8d5dc8c1450fa32654a1";
let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log("PASS:", message);
  } else {
    console.error("FAIL:", message);
    failures++;
  }
}

try {
  // TEST 1: Chuẩn bị đơn hàng hợp lệ
  const order = await prepareOrder({
    customerAuthUserId: 1,
    items: [
      {
        productId,
        quantity: 2
      }
    ]
  });

  console.log("\nORDER SUMMARY:");
  console.log(JSON.stringify(order, null, 2));

  check(
    order.customerAuthUserId === 1,
    "TEST 1: Correct customer ID"
  );

  check(
    order.membershipTier === "TEST-SILVER",
    "TEST 2: Correct membership tier"
  );

  check(
    order.subtotal === 200000,
    "TEST 3: Subtotal = 200000"
  );

  check(
    order.discountPercent === 5 &&
    order.discountAmount === 10000,
    "TEST 4: Discount 5% = 10000"
  );

  check(
    order.totalAmount === 190000,
    "TEST 5: Total amount = 190000"
  );

  check(
    order.items.length === 1 &&
    order.items[0].unitPrice === 100000 &&
    order.items[0].quantity === 2,
    "TEST 6: Correct product price and quantity"
  );

  // TEST 7: Từ chối sản phẩm trùng
  try {
    await prepareOrder({
      customerAuthUserId: 1,
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 1 }
      ]
    });

    check(false, "TEST 7: Duplicate product rejected");
  } catch (error) {
    check(
      error.code === "DUPLICATE_ORDER_PRODUCT",
      "TEST 7: Duplicate product rejected"
    );
  }

  // TEST 8: Từ chối số lượng không hợp lệ
  try {
    await prepareOrder({
      customerAuthUserId: 1,
      items: [
        { productId, quantity: 0 }
      ]
    });

    check(false, "TEST 8: Invalid quantity rejected");
  } catch (error) {
    check(
      error.code === "INVALID_ORDER_ITEMS",
      "TEST 8: Invalid quantity rejected"
    );
  }

} catch (error) {
  console.error("TEST ERROR:", error.message);
  failures++;
}

console.log("\nTEST RESULT:");
console.log("Failures:", failures);

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED");
}
