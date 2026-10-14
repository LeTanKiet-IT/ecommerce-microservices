
import { Router } from "express";
import { z } from "zod";

import { internalAuth } from "./middlewares/internal-auth.js";
import { stockReservationRepository } from "../../infrastructure/repositories/stock-reservation.repository.js";

const router = Router();

// Bảo vệ toàn bộ API Reservation bằng token nội bộ
router.use(internalAuth);

// Kiểm tra định dạng Reservation ID
const reservationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/);

// Schema giữ hàng
const reserveSchema = z.object({
  reservationId: reservationIdSchema,
  items: z.array(
    z.object({
      productId: z.string().regex(/^[a-fA-F0-9]{24}$/),
      quantity: z.number().int().positive().safe()
    }).strict()
  ).min(1)
}).strict();

// Schema xác nhận giữ hàng
const confirmSchema = z.object({
  orderReference: z.string().trim().min(1).max(100)
}).strict();

// Hàm kiểm tra dữ liệu đầu vào
function validate(schema, data) {
  const result = schema.safeParse(data);

  if (!result.success) {
    const error = new Error("Invalid request data");
    error.status = 400;
    throw error;
  }

  return result.data;
}

// 1. GET - Tra cứu trạng thái Reservation theo ID
// GET /internal/stock-reservations/:id
router.get("/:id", async (req, res) => {
  const reservationId = validate(
    reservationIdSchema,
    req.params.id
  );

  const reservation =
    await stockReservationRepository.findByReservationId(
      reservationId
    );

  return res.status(200).json(reservation);
});

// 2. POST - Giữ hàng
// POST /internal/stock-reservations
router.post("/", async (req, res) => {
  const data = validate(reserveSchema, req.body);

  const reservation =
    await stockReservationRepository.reserve(data);

  return res.status(200).json(reservation);
});

// 3. POST - Xác nhận giữ hàng
// POST /internal/stock-reservations/:id/confirm
router.post("/:id/confirm", async (req, res) => {
  const reservationId = validate(
    reservationIdSchema,
    req.params.id
  );

  const { orderReference } = validate(
    confirmSchema,
    req.body
  );

  const reservation =
    await stockReservationRepository.confirm(
      reservationId,
      orderReference
    );

  return res.status(200).json(reservation);
});

// 4. POST - Hoàn trả hàng
// POST /internal/stock-reservations/:id/release
router.post("/:id/release", async (req, res) => {
  const reservationId = validate(
    reservationIdSchema,
    req.params.id
  );

  const reservation =
    await stockReservationRepository.release(
      reservationId
    );

  return res.status(200).json(reservation);
});

export default router;
