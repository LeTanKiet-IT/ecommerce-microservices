import { Router } from "express";
import { z } from "zod";
import { registerUser } from "../application/register-user.js";
import { loginUser } from "../application/login-user.js";

const router = Router();

const registerSchema = z
  .object({
    username: z.string().trim().min(3).max(50),
    password: z
      .string()
      .min(8)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
        message: "Password must be at most 72 bytes",
      }),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().min(8).max(20),
  })
  .strict();

const loginSchema = z
  .object({
    username: z.string().trim().min(3).max(50),
    password: z
      .string()
      .min(1)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
        message: "Password must be at most 72 bytes",
      }),
  })
  .strict();

router.post("/register", async (req, res) => {
  const validation = registerSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      message: "Invalid registration data",
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const user = await registerUser(validation.data);

    return res.status(201).json({
      message: "User registered successfully",
      uid: Number(user.uid),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }

    console.error("Registration failed:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

router.post("/login", async (req, res) => {
  const validation = loginSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({
      message: "Invalid login data",
      errors: validation.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    const result = await loginUser(validation.data);

    if (!result) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    return res.status(200).json({
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    console.error("Login failed:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

export default router;