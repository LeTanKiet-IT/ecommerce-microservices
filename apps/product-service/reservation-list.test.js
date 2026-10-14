import mongoose from "mongoose";
import { StockReservationModel } from "./src/infrastructure/models/stock-reservation.model.js";

const uri = process.env.PRODUCT_MONGO_URL;

if (!uri) {
  throw new Error("PRODUCT_MONGO_URL is missing");
}

try {
  await mongoose.connect(uri);

  const reservations = await StockReservationModel.find(
    {},
    {
      _id: 0,
      reservationId: 1,
      status: 1,
      orderReference: 1,
      items: 1
    }
  )
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  console.log("Reservations found:", reservations.length);

  for (const reservation of reservations) {
    console.log({
      reservationId: reservation.reservationId,
      status: reservation.status,
      orderReference: reservation.orderReference,
      items: reservation.items.map(item => ({
        productId: String(item.productId),
        quantity: item.quantity
      }))
    });
  }
} finally {
  await mongoose.disconnect();
}
