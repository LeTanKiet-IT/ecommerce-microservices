import mongoose from "mongoose";

export async function connectDatabase() {
  const mongoUrl = process.env.PRODUCT_MONGO_URL;

  if (!mongoUrl) {
    throw new Error("PRODUCT_MONGO_URL is not configured");
  }

  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log("Product MongoDB connected");
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}