import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";

try {
  await connectDatabase();

  const id = randomUUID().replaceAll("-", "");

  const product = await ProductModel.create({
    sku: `HTTP-TEST-${id}`,
    name: "HTTP Reservation Test",
    price: 100000,
    stockQuantity: 10,
    status: "ACTIVE"
  });

  console.log("PRODUCT_ID=" + product._id.toString());
  console.log("INITIAL_STOCK=" + product.stockQuantity);
} finally {
  await mongoose.disconnect();
}
