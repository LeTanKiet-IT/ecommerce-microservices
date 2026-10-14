import mongoose from "mongoose";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";
import { productRepository } from "./src/infrastructure/repositories/product.repository.js";

let testProduct;

try {
  await connectDatabase();

  testProduct = await ProductModel.create({
    sku: `STOCK-TEST-${Date.now()}`,
    name: "Stock Test Product",
    price: 100000,
    stockQuantity: 5,
    status: "ACTIVE"
  });

  console.log("Initial stock:", testProduct.stockQuantity);

  const first = await productRepository.decreaseStock(
    testProduct._id,
    3
  );

  if (first?.stockQuantity !== 2) {
    throw new Error("Test 1 failed: expected stock 2");
  }

  console.log("Test 1 PASS: Stock 5 -> 2");

  const second = await productRepository.decreaseStock(
    testProduct._id,
    4
  );

  if (second !== null) {
    throw new Error("Test 2 failed: insufficient stock accepted");
  }

  const finalProduct = await ProductModel.findById(
    testProduct._id
  ).lean();

  if (finalProduct.stockQuantity !== 2) {
    throw new Error("Test 3 failed: stock changed unexpectedly");
  }

  console.log("Test 2 PASS: Insufficient stock rejected");
  console.log("Test 3 PASS: Final stock =", finalProduct.stockQuantity);
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (testProduct?._id) {
    await ProductModel.deleteOne({ _id: testProduct._id });
    console.log("Test product cleaned up");
  }

  await mongoose.disconnect();
}
