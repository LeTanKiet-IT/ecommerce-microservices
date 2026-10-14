import mongoose from "mongoose";
import { connectDatabase } from "./src/infrastructure/database.js";
import { ProductModel } from "./src/infrastructure/models/product.model.js";
import { StockReservationModel } from "./src/infrastructure/models/stock-reservation.model.js";

const productId = "6ace8887d25ac1797220d00c";

try {
  await connectDatabase();

  const product = await ProductModel.findById(productId);

  if (!product || !product.sku.startsWith("HTTP-TEST-")) {
    throw new Error("Product is not a recognized test product");
  }

  const reservations = await StockReservationModel.find({
    "items.productId": new mongoose.Types.ObjectId(productId)
  });

  console.log("Test product:", product.sku);
  console.log("Reservations found:", reservations.length);

  if (
    reservations.some(r =>
      r.items.some(i => i.productId.toString() !== productId)
    )
  ) {
    throw new Error("Multi-product reservation detected. Cleanup aborted.");
  }

  if (
    reservations.some(r =>
      !["RELEASED", "CONFIRMED"].includes(r.status)
    )
  ) {
    throw new Error("Active reservation detected. Cleanup aborted.");
  }

  const ids = reservations.map(r => r._id);

  await StockReservationModel.deleteMany({
    _id: { $in: ids }
  });

  await ProductModel.deleteOne({ _id: productId });

  console.log("Test data cleaned successfully");
} catch (error) {
  console.error("Cleanup failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
