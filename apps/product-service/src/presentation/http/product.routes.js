import { Router } from "express";
import { z } from "zod";
import { productRepository } from "../../infrastructure/repositories/product.repository.js";
import { createProductUseCases } from "../../application/product.use-cases.js";

const router = Router();
const product = createProductUseCases(productRepository);

const productSchema = z
  .object({
    sku: z.string().trim().min(3).max(40),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    price: z.number().nonnegative(),
    stockQuantity: z.number().int().nonnegative().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict();

const updateProductSchema = productSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid product data",
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

function isValidId(id) {
  return /^[a-f\d]{24}$/i.test(id);
}

router.get("/", async (req, res) => {
  const products = await product.listProducts();
  return res.status(200).json({ items: products, count: products.length });
});

router.get("/:id", async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  const found = await product.getProductById(req.params.id);

  if (!found) {
    return res.status(404).json({ message: "Product not found" });
  }

  return res.status(200).json(found);
});

router.post("/", validateBody(productSchema), async (req, res) => {
  const created = await product.createProduct(req.validatedBody);
  return res.status(201).json(created);
});

router.put("/:id", validateBody(updateProductSchema), async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  const updated = await product.updateProduct(
    req.params.id,
    req.validatedBody
  );

  if (!updated) {
    return res.status(404).json({ message: "Product not found" });
  }

  return res.status(200).json(updated);
});

router.delete("/:id", async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ message: "Invalid product ID" });
  }

  const deleted = await product.deleteProduct(req.params.id);

  if (!deleted) {
    return res.status(404).json({ message: "Product not found" });
  }

  return res.status(200).json({
    message: "Product deleted successfully",
    id: req.params.id,
  });
});

export default router;
