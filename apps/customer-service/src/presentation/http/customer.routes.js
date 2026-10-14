import { Router } from "express";
import { z } from "zod";
import { customerRepository } from "../../infrastructure/repositories/customer.repository.js";
import { scoreRepository } from "../../infrastructure/repositories/score.repository.js";
import { createCustomerUseCases } from "../../application/customer.use-cases.js";

const router = Router();
const customer = createCustomerUseCases({
  customerRepository,
  scoreRepository,
});

const authUserIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);

const createProfileSchema = z
  .object({
    authUserId: authUserIdSchema,
    fullName: z.string().trim().min(2).max(100),
    address: z.string().trim().max(500).optional(),
  })
  .strict();

const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    address: z.string().trim().max(500).optional(),
  })
  .strict();

const scoreAdjustmentSchema = z
  .object({
    pointsDelta: z.number().int().safe().refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(255),
    orderReference: z.string().trim().max(100).optional(),
  })
  .strict();

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid customer data",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    req.validatedBody = result.data;
    return next();
  };
}

function validAuthUserId(id) {
  return authUserIdSchema.safeParse(id).success;
}

router.post("/", validate(createProfileSchema), async (req, res) => {
  const created = await customer.createProfile(req.validatedBody);
  return res.status(201).json(created);
});

router.get("/:authUserId", async (req, res) => {
  if (!validAuthUserId(req.params.authUserId)) {
    return res.status(400).json({ message: "Invalid auth user ID" });
  }

  const profile = await customer.getProfile(req.params.authUserId);

  if (!profile) {
    return res.status(404).json({ message: "Customer not found" });
  }

  return res.status(200).json(profile);
});

router.put(
  "/:authUserId",
  validate(updateProfileSchema),
  async (req, res) => {
    if (!validAuthUserId(req.params.authUserId)) {
      return res.status(400).json({ message: "Invalid auth user ID" });
    }

    const profile = await customer.updateProfile(
      req.params.authUserId,
      req.validatedBody
    );

    if (!profile) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(200).json(profile);
  }
);

router.get("/:authUserId/score-transactions", async (req, res) => {
  if (!validAuthUserId(req.params.authUserId)) {
    return res.status(400).json({ message: "Invalid auth user ID" });
  }

  const transactions = await customer.getScoreHistory(req.params.authUserId);
  return res.status(200).json({
    items: transactions,
    count: transactions.length,
  });
});

router.post(
  "/:authUserId/score-transactions",
  validate(scoreAdjustmentSchema),
  async (req, res) => {
    if (!validAuthUserId(req.params.authUserId)) {
      return res.status(400).json({ message: "Invalid auth user ID" });
    }

    try {
      const updated = await customer.adjustScore({
        authUserId: req.params.authUserId,
        ...req.validatedBody,
      });

      if (!updated) {
        return res.status(404).json({ message: "Customer not found" });
      }

      return res.status(200).json(updated);
    } catch (error) {
      if (error.code === "INSUFFICIENT_SCORE") {
        return res.status(409).json({ message: error.message });
      }

      throw error;
    }
  }
);

export default router;
