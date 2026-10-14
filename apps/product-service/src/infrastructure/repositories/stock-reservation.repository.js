
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model.js";
import { StockReservationModel } from "../models/stock-reservation.model.js";

export const stockReservationRepository = {
  // 1. Tra cứu Reservation theo ID
  async findByReservationId(reservationId) {
    if (
      typeof reservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(reservationId)
    ) {
      const error = new Error("Invalid reservation ID");
      error.status = 400;
      throw error;
    }

    const reservation = await StockReservationModel.findOne({
      reservationId,
    }).lean();

    if (!reservation) {
      const error = new Error("Reservation not found");
      error.code = "RESERVATION_NOT_FOUND";
      throw error;
    }

    return {
      reservationId: reservation.reservationId,
      status: reservation.status,
      orderReference: reservation.orderReference,
      items: reservation.items.map((item) => ({
        productId: String(item.productId),
        quantity: item.quantity,
      })),
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  },

  // 2. Hoàn trả tồn kho
  async release(reservationId) {
    if (
      typeof reservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(reservationId)
    ) {
      throw new Error("Invalid reservation ID");
    }

    const session = await mongoose.startSession();

    try {
      return await session.withTransaction(async () => {
        const reservation =
          await StockReservationModel.findOne({
            reservationId
          }).session(session);

        if (!reservation) {
          const error = new Error("Reservation not found");
          error.code = "RESERVATION_NOT_FOUND";
          throw error;
        }

        if (reservation.status === "RELEASED") {
          return reservation.toObject();
        }

        if (reservation.status === "CONFIRMED") {
          const error = new Error(
            "Confirmed reservation cannot be released"
          );
          error.code = "RESERVATION_CONFLICT";
          throw error;
        }

        if (reservation.status !== "RESERVED") {
          const error = new Error(
            "Invalid reservation status"
          );
          error.code = "RESERVATION_CONFLICT";
          throw error;
        }

        for (const item of reservation.items) {
          const updated = await ProductModel.updateOne(
            { _id: item.productId },
            {
              $inc: {
                stockQuantity: item.quantity
              }
            },
            { session }
          );

          if (updated.matchedCount !== 1) {
            const error = new Error(
              "Cannot restore stock: product not found"
            );
            error.code = "PRODUCT_NOT_FOUND";
            throw error;
          }
        }

        reservation.status = "RELEASED";
        await reservation.save({ session });

        return reservation.toObject();
      });
    } finally {
      await session.endSession();
    }
  },

  // 3. Xác nhận Reservation cho Order
  async confirm(reservationId, orderReference) {
    if (
      typeof reservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(reservationId)
    ) {
      throw new Error("Invalid reservation ID");
    }

    if (
      typeof orderReference !== "string" ||
      orderReference.trim().length === 0 ||
      orderReference.length > 100
    ) {
      throw new Error("Invalid order reference");
    }

    const updated = await StockReservationModel.findOneAndUpdate(
      {
        reservationId,
        status: "RESERVED"
      },
      {
        $set: {
          status: "CONFIRMED",
          orderReference
        }
      },
      {
        returnDocument: "after",
        runValidators: true
      }
    ).lean();

    if (updated) {
      return updated;
    }

    const existing = await StockReservationModel.findOne({
      reservationId
    }).lean();

    if (!existing) {
      const error = new Error("Reservation not found");
      error.code = "RESERVATION_NOT_FOUND";
      throw error;
    }

    if (
      existing.status === "CONFIRMED" &&
      existing.orderReference === orderReference
    ) {
      return existing;
    }

    const error = new Error(
      "Reservation cannot be confirmed"
    );
    error.code = "RESERVATION_CONFLICT";
    throw error;
  },

  // 4. Giữ hàng trong MongoDB Transaction
  async reserve({ reservationId, items }) {
    if (
      typeof reservationId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(reservationId)
    ) {
      throw new Error("Invalid reservation ID");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Reservation must contain items");
    }

    const normalizedItems = items.map((item) => {
      if (
        !mongoose.isValidObjectId(item.productId) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        throw new Error("Invalid reservation item");
      }

      return {
        productId: new mongoose.Types.ObjectId(item.productId),
        quantity: item.quantity,
      };
    });

    const productIds = normalizedItems.map(
      (item) => item.productId.toString()
    );

    if (new Set(productIds).size !== productIds.length) {
      throw new Error("Duplicate products in reservation");
    }

    // Bảo đảm unique index đã sẵn sàng
    await StockReservationModel.init();

    const session = await mongoose.startSession();

    try {
      return await session.withTransaction(async () => {
        const existing = await StockReservationModel.findOne({
          reservationId,
        }).session(session);

        if (existing) {
          const sameItems =
            JSON.stringify(
              existing.items
                .map((item) => ({
                  productId: item.productId.toString(),
                  quantity: item.quantity,
                }))
                .sort((a, b) =>
                  a.productId.localeCompare(b.productId)
                )
            ) ===
            JSON.stringify(
              normalizedItems
                .map((item) => ({
                  productId: item.productId.toString(),
                  quantity: item.quantity,
                }))
                .sort((a, b) =>
                  a.productId.localeCompare(b.productId)
                )
            );

          if (!sameItems) {
            throw new Error(
              "Reservation ID already used for different items"
            );
          }

          return existing.toObject();
        }

        for (const item of normalizedItems) {
          const updated = await ProductModel.findOneAndUpdate(
            {
              _id: item.productId,
              status: "ACTIVE",
              stockQuantity: { $gte: item.quantity },
            },
            {
              $inc: { stockQuantity: -item.quantity },
            },
            {
              session,
              returnDocument: "after",
              runValidators: true,
            }
          );

          if (!updated) {
            const error = new Error(
              "Product unavailable or insufficient stock"
            );
            error.code = "INSUFFICIENT_STOCK";
            throw error;
          }
        }

        const created = await StockReservationModel.create(
          [
            {
              reservationId,
              items: normalizedItems,
              status: "RESERVED",
            },
          ],
          { session }
        );

        return created[0].toObject();
      });
    } finally {
      await session.endSession();
    }
  },
};
