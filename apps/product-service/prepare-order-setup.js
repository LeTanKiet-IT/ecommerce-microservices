import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";

try {
  await connectDatabase();

  const testId = randomUUID().replaceAll("-", "");

  const product = await ProductModel.create({
    sku: `ORDER-${testId}`,
    name: "Test Product Order",
    price: 100000,
    stockQuantity: 10,
    status: "ACTIVE"
  });

  console.log("PRODUCT_ID=" + product._id.toString());
  console.log("SKU=" + product.sku);
  console.log("PRICE=" + product.price);
  console.log("STOCK=" + product.stockQuantity);
  console.log("STATUS=" + product.status);
} catch (error) {
  console.error("SETUP FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
