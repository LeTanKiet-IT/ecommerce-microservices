
import { Router } from "express";
import {
  createOrderController,
  getOrderController,
} from "../controllers/order.controller.js";

const router = Router();

router.post("/", createOrderController);
router.get("/:orderId", getOrderController);

export default router;
