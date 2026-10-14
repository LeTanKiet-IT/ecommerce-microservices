import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";
import { StockReservationModel } from "./src/infrastructure/models/stock-reservation.model.js";
import { stockReservationRepository } from "./src/infrastructure/repositories/stock-reservation.repository.js";

const testId = randomUUID().replaceAll("-", "");
const reservationId = `TEST_${testId}`;
const orderReference = `ORDER_${testId}`;

let productId;
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
    sku: `CONFIRM-${testId}`,
    name: "Confirm Test Product",
    price: 100000,
    stockQuantity: 10,
    status: "ACTIVE"
  });

  productId = product._id;

  const reserved = await stockReservationRepository.reserve({
    reservationId,
    items: [
      { productId: String(productId), quantity: 3 }
    ]
  });

  check(
    reserved.status === "RESERVED",
    "Reservation created"
  );

  const confirmed = await stockReservationRepository.confirm(
    reservationId,
    orderReference
  );

  check(
    confirmed.status === "CONFIRMED" &&
    confirmed.orderReference === orderReference,
    "TEST 1: Confirm RESERVED -> CONFIRMED"
  );

  const repeated = await stockReservationRepository.confirm(
    reservationId,
    orderReference
  );

  const currentProduct = await ProductModel.findById(
    productId
  ).lean();

  check(
    repeated.status === "CONFIRMED" &&
    currentProduct.stockQuantity === 7,
    "TEST 2: Repeated confirm - stock remains 7"
  );

  try {
    await stockReservationRepository.confirm(
      reservationId,
      "OTHER_ORDER"
    );

    check(false, "TEST 3: Different order reference rejected");
  } catch (error) {
    check(
      error.code === "RESERVATION_CONFLICT",
      "TEST 3: Different order reference rejected"
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
    await StockReservationModel.deleteOne({ reservationId });

    if (productId) {
      await ProductModel.deleteOne({ _id: productId });
    }

    console.log("Test data cleaned up");
  } catch (error) {
    console.error("CLEANUP ERROR:", error.message);
    process.exitCode = 1;
  }

  await mongoose.disconnect();
}
