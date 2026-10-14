import { timingSafeEqual } from "node:crypto";

export function internalAuth(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const provided = req.get("x-internal-token");

  if (!expected || !provided) {
    return res.status(401).json({
      message: "Unauthorized internal request"
    });
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({
      message: "Unauthorized internal request"
    });
  }

  return next();
}
