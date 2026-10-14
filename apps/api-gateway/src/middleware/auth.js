import jwt from "jsonwebtoken";

export function authenticateToken(req, res, next) {
  const authorization = req.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Bearer access token is required",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.AUTH_JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      typeof payload.role !== "string"
    ) {
      return res.status(401).json({
        message: "Invalid access token",
      });
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role,
    };

    return next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired access token",
    });
  }
}

export function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        message: "Authentication is required",
      });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        message: "You do not have permission to access this resource",
      });
    }

    return next();
  };
}