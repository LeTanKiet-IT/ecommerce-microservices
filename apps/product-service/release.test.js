import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";
import { StockReservationModel } from "./src/infrastructure/models/stock-reservation.model.js";
import { stockReservationRepository } from "./src/infrastructure/repositories/stock-reservation.repository.js";

const testId = randomUUID().replaceAll("-", "");
const reservationId1 = `RELEASE_${testId}_1`;
const reservationId2 = `RELEASE_${testId}_2`;

const productIds = [];
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
  await connectDatabase();

  const product = await ProductModel.create({
    sku: `RELEASE-${testId}`,
    name: "Release Test Product",
    price: 100000,
    stockQuantity: 10,
    status: "ACTIVE"
  });

  productIds.push(product._id);

  // TEST 1: Giữ 3 sản phẩm
  await stockReservationRepository.reserve({
    reservationId: reservationId1,
    items: [
      { productId: String(product._id), quantity: 3 }
    ]
  });

  const afterReserve = await ProductModel.findById(
    product._id
  ).lean();

  check(
    afterReserve.stockQuantity === 7,
    "TEST 1: Reserve stock 10 -> 7"
  );

  // TEST 2: Release trả tồn kho về 10
  const released = await stockReservationRepository.release(
    reservationId1
  );

  const afterRelease = await ProductModel.findById(
    product._id
  ).lean();

  check(
    released.status === "RELEASED" &&
    afterRelease.stockQuantity === 10,
    "TEST 2: Release stock 7 -> 10"
  );

  // TEST 3: Release lần hai không cộng trùng
  const repeated = await stockReservationRepository.release(
    reservationId1
  );

  const afterRepeated = await ProductModel.findById(
    product._id
  ).lean();

  check(
    repeated.status === "RELEASED" &&
    afterRepeated.stockQuantity === 10,
    "TEST 3: Repeated release - stock remains 10"
  );

  // TEST 4: Không cho Release sau Confirm
  await stockReservationRepository.reserve({
    reservationId: reservationId2,
    items: [
      { productId: String(product._id), quantity: 2 }
    ]
  });

  await stockReservationRepository.confirm(
    reservationId2,
    `ORDER_${testId}`
  );

  try {
    await stockReservationRepository.release(
      reservationId2
    );

    check(
      false,
      "TEST 4: Release after confirm rejected"
    );
  } catch (error) {
    const finalProduct = await ProductModel.findById(
      product._id
    ).lean();

    check(
      error.code === "RESERVATION_CONFLICT" &&
      finalProduct.stockQuantity === 8,
      "TEST 4: Release after confirm rejected"
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
    await StockReservationModel.deleteMany({
      reservationId: {
        $in: [reservationId1, reservationId2]
      }
    });

    if (productIds.length > 0) {
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
