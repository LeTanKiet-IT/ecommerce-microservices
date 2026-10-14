import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserByUsername } from "../repositories/user.repository.js";

export async function loginUser({ username, password }) {
  const user = await findUserByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return null;
  }

  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET is not configured");

  const expiresIn = Number(process.env.AUTH_JWT_EXPIRES_IN || 3600);
  const accessToken = jwt.sign(
    { role: user.role_name },
    secret,
    {
      algorithm: "HS256",
      subject: String(user.uid),
      expiresIn,
    }
  );

  return { accessToken, expiresIn };
}