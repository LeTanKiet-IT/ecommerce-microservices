import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import {
  connectRedis,
  redisClient,
} from "../infra/redis-client.js";

export async function createApiRateLimiter() {
  await connectRedis();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      message: "Too many requests. Please try again later.",
    },
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
  });

  return limiter;
}