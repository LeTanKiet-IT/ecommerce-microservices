import bcrypt from "bcryptjs";
import { createCustomerUser } from "../repositories/user.repository.js";

export async function registerUser(input) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return createCustomerUser({
    username: input.username,
    email: input.email.toLowerCase(),
    phone: input.phone,
    passwordHash,
  });
}