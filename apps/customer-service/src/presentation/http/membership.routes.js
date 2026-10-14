import { Router } from "express";
import { z } from "zod";
import { membershipRepository } from "../../infrastructure/repositories/membership.repository.js";
import { createMembershipUseCases } from "../../application/membership.use-cases.js";

const router = Router();
const membership = createMembershipUseCases(membershipRepository);

const tierSchema = z
  .object({
    tierName: z.string().trim().min(2).max(50),
    minScore: z.number().int().nonnegative(),
    discountPercent: z.number().min(0).max(100),
  })
  .strict();

function validateTier(req, res, next) {
  const result = tierSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      message: "Invalid membership tier data",
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  req.validatedBody = result.data;
  return next();
}

function validId(id) {
  return /^[1-9]\d*$/.test(id);
}

router.get("/", async (req, res) => {
  const tiers = await membership.listTiers();
  return res.status(200).json({ items: tiers, count: tiers.length });
});

router.get("/by-score/:score", async (req, res) => {
  const score = Number(req.params.score);

  if (!Number.isSafeInteger(score) || score < 0) {
    return res.status(400).json({ message: "Score must be a non-negative integer" });
  }

  const tier = await membership.getTierForScore(score);
  return res.status(200).json({ score, tier });
});

router.post("/", validateTier, async (req, res) => {
  const created = await membership.createTier(req.validatedBody);
  return res.status(201).json(created);
});

router.put("/:id", validateTier, async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ message: "Invalid membership tier ID" });
  }

  const updated = await membership.updateTier(req.params.id, req.validatedBody);

  if (!updated) {
    return res.status(404).json({ message: "Membership tier not found" });
  }

  return res.status(200).json(updated);
});

router.delete("/:id", async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).json({ message: "Invalid membership tier ID" });
  }

  const deleted = await membership.deleteTier(req.params.id);

  if (!deleted) {
    return res.status(404).json({ message: "Membership tier not found" });
  }

  return res.status(200).json({
    message: "Membership tier deleted successfully",
    id: deleted.tier_id,
  });
});

export default router;
