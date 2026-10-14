import mongoose from "mongoose";

const reservationItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Product"
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Quantity must be a positive integer"
      }
    }
  },
  {
    _id: false
  }
);

const stockReservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    items: {
      type: [reservationItemSchema],
      required: true,
      validate: {
        validator: (items) =>
          Array.isArray(items) && items.length > 0,
        message: "Reservation must contain items"
      }
    },

    status: {
      type: String,
      enum: ["RESERVED", "CONFIRMED", "RELEASED"],
      default: "RESERVED",
      required: true
    },

    orderReference: {
      type: String,
      default: null
    },

    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const StockReservationModel = mongoose.model(
  "StockReservation",
  stockReservationSchema
);
