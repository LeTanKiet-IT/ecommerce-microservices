import { ProductModel } from "../models/product.model.js";

export const productRepository = {
  findAll() {
    return ProductModel.find().sort({ createdAt: -1 }).lean();
  },

  findById(id) {
    return ProductModel.findById(id).lean();
  },

  create(data) {
    return ProductModel.create(data);
  },

  updateById(id, data) {
    return ProductModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).lean();
  },

  async decreaseStock(productId, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive integer");
    }

    return ProductModel.findOneAndUpdate(
      {
        _id: productId,
        status: "ACTIVE",
        stockQuantity: { $gte: quantity }
      },
      {
        $inc: { stockQuantity: -quantity }
      },
      {
        returnDocument: "after",
        runValidators: true
      }
    ).lean();
  },
  deleteById(id) {
    return ProductModel.findByIdAndDelete(id).lean();
  },
};
