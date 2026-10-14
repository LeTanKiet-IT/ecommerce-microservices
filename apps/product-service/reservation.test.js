import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";
import { StockReservationModel } from "./src/infrastructure/models/stock-reservation.model.js";
import { stockReservationRepository } from "./src/infrastructure/repositories/stock-reservation.repository.js";

const testId = randomUUID().replaceAll("-", "");
const reservationIds = [
  `TEST_${testId}_1`,
  `TEST_${testId}_2`
];

const productIds = [];
let failures = 0;

function check(condition, message) {
  if (!condition) {
    failures++;
    console.error("FAIL:", message);
  } else {
    console.log("PASS:", message);
  }
}

try {
  await connectDatabase();

  const products = await ProductModel.create([
    {
      sku: `TEST-A-${testId}`,
      name: "Reservation Test A",
      price: 100000,
      stockQuantity: 10,
      status: "ACTIVE"
    },
    {
      sku: `TEST-B-${testId}`,
      name: "Reservation Test B",
      price: 200000,
      stockQuantity: 2,
      status: "ACTIVE"
    }
  ]);

  const [a, b] = products;
  productIds.push(a._id, b._id);

  // TEST 1: Giữ 3 sản phẩm A
  const first = await stockReservationRepository.reserve({
    reservationId: reservationIds[0],
    items: [{ productId: String(a._id), quantity: 3 }]
  });

  let currentA = await ProductModel.findById(a._id).lean();

  check(
    first.status === "RESERVED" &&
    currentA.stockQuantity === 7,
    "TEST 1: Reserve 3 products (10 -> 7)"
  );

  // TEST 2: Gửi lại cùng reservationId
  const repeated = await stockReservationRepository.reserve({
    reservationId: reservationIds[0],
    items: [{ productId: String(a._id), quantity: 3 }]
  });

  currentA = await ProductModel.findById(a._id).lean();

  check(
    repeated.reservationId === reservationIds[0] &&
    currentA.stockQuantity === 7,
    "TEST 2: Idempotency - stock remains 7"
  );

  // TEST 3: Yêu cầu vượt tồn kho
  try {
    await stockReservationRepository.reserve({
      reservationId: reservationIds[1],
      items: [{ productId: String(a._id), quantity: 100 }]
    });

    check(false, "TEST 3: Insufficient stock rejected");
  } catch (error) {
    currentA = await ProductModel.findById(a._id).lean();

    check(
      error.code === "INSUFFICIENT_STOCK" &&
      currentA.stockQuantity === 7,
      "TEST 3: Insufficient stock rejected"
    );
  }

  // TEST 4: Multi-item transaction rollback
  try {
    await stockReservationRepository.reserve({
      reservationId: reservationIds[1],
      items: [
        { productId: String(a._id), quantity: 2 },
        { productId: String(b._id), quantity: 5 }
      ]
    });

    check(false, "TEST 4: Transaction rollback");
  } catch (error) {
    const finalA = await ProductModel.findById(a._id).lean();
    const finalB = await ProductModel.findById(b._id).lean();

    check(
      error.code === "INSUFFICIENT_STOCK" &&
      finalA.stockQuantity === 7 &&
      finalB.stockQuantity === 2,
      "TEST 4: Transaction rollback - stock unchanged"
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("TEST ERROR:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (reservationIds.length) {
      await StockReservationModel.deleteMany({
        reservationId: { $in: reservationIds }
      });
    }

    if (productIds.length) {
      await ProductModel.deleteMany({
        _id: { $in: productIds }
      });
    }

    console.log("Test data cleaned up");
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
    process.exitCode = 1;
  }

  await mongoose.disconnect();
}
