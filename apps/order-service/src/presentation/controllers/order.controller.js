
import { placeOrder } from "../../application/use-cases/place-order.use-case.js";
import { orderRepository } from "../../infrastructure/repositories/order.repository.js";

export async function createOrderController(req, res) {
  try {
    const idempotencyKey = req.get("Idempotency-Key");

    if (!idempotencyKey) {
      return res.status(400).json({
        code: "MISSING_IDEMPOTENCY_KEY",
        message: "Idempotency-Key header is required",
      });
    }

    const { customerAuthUserId, items } = req.body ?? {};

    if (
      !Number.isSafeInteger(customerAuthUserId) ||
      customerAuthUserId <= 0 ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        code: "INVALID_ORDER_REQUEST",
        message: "Valid customerAuthUserId and items are required",
      });
    }

    const order = await placeOrder({
      idempotencyKey,
      customerAuthUserId,
      items,
    });

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Create Order failed:", error);

    const status =
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      code: error.code || "ORDER_CREATION_FAILED",
      message:
        status === 500
          ? "Internal server error"
          : error.message,
    });
  }
}

export async function getOrderController(req, res) {
  try {
    const { orderId } = req.params;

    if (!/^[1-9]\d*$/.test(orderId)) {
      return res.status(400).json({
        code: "INVALID_ORDER_ID",
        message: "Invalid Order ID",
      });
    }

    const order = await orderRepository.findById(orderId);

    if (!order) {
      return res.status(404).json({
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Get Order failed:", error.message);

    return res.status(500).json({
      success: false,
      code: "ORDER_LOOKUP_FAILED",
      message: "Internal server error",
    });
  }
}
