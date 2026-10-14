
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";

import { createApiRateLimiter } from "./middleware/rate-limit.js";
import {
  authenticateToken,
  authorizeRoles,
} from "./middleware/auth.js";

const app = express();

const port = Number(process.env.API_GATEWAY_PORT || 3000);

const AUTH_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001/api/auth";

const ORDER_URL =
  process.env.ORDER_SERVICE_URL || "http://localhost:3004";

const SHIPMENT_URL =
  process.env.SHIPMENT_SERVICE_URL || "http://localhost:3005";

const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;

app.disable("x-powered-by");
app.use(helmet());
app.use(morgan("dev"));

// ==================================================
// 1. REDIS RATE LIMITING
// ==================================================

const apiRateLimiter = await createApiRateLimiter();

app.use("/api", apiRateLimiter);

// ==================================================
// 2. HEALTH CHECK
// ==================================================

app.get("/api/health", async (req, res) => {
  try {
    const response = await fetch(
      process.env.AUTH_SERVICE_HEALTH_URL,
      { signal: AbortSignal.timeout(5000) }
    );

    const authHealth = await response.json();

    if (!response.ok) {
      return res.status(503).json({
        status: "DEGRADED",
        authService: authHealth.status,
        authDatabase: authHealth.database,
      });
    }

    return res.status(200).json({
      status: "UP",
      authService: authHealth.service,
      authDatabase: authHealth.database,
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    return res.status(503).json({
      status: "DEGRADED",
      authService: "DOWN",
    });
  }
});

// ==================================================
// 3. JWT AUTHENTICATION
// ==================================================

app.use("/api", (req, res, next) => {
  const isPublicAuthRequest =
    req.method === "POST" &&
    ["/auth/login", "/auth/register"].includes(req.path);

  if (isPublicAuthRequest) {
    return next();
  }

  return authenticateToken(req, res, next);
});

// ADMIN authorization
app.use("/api/admin", authorizeRoles("ADMIN"));

// ==================================================
// 4. AUTH SERVICE PROXY
// ==================================================

// Gateway: /api/auth/login
// Auth Service: /api/auth/login
//
// Khi mount tai /api/auth, Express se bo prefix.
// Vi vay target can ket thuc bang /api/auth.

app.use(
  "/api/auth",
  createProxyMiddleware({
    target: AUTH_URL,
    changeOrigin: true,

    proxyTimeout: 15000,
    timeout: 15000,

    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader("x-internal-token");
      },

      error: (error, req, res) => {
        console.error(
          "Auth Proxy error:",
          error.message
        );

        if (!res.headersSent) {
          res.writeHead(502, {
            "Content-Type": "application/json",
          });
        }

        if (!res.writableEnded) {
          res.end(
            JSON.stringify({
              success: false,
              code: "AUTH_SERVICE_UNAVAILABLE",
              message: "Auth Service is unavailable",
            })
          );
        }
      },
    },
  })
);

// ==================================================
// 5. GET USER ID FROM JWT
// ==================================================

function getAuthenticatedUserId(req, res) {
  const userId = Number(req.auth?.userId);

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    res.status(401).json({
      success: false,
      code: "INVALID_USER_ID",
      message: "Invalid authenticated user",
    });

    return null;
  }

  return userId;
}

// ==================================================
// 6. INTERNAL SERVICE CLIENT
// ==================================================

async function callInternalService(
  baseUrl,
  path,
  { method = "GET", body, headers = {} } = {}
) {
  if (!INTERNAL_TOKEN) {
    const error = new Error(
      "Internal service token is not configured"
    );
    error.code = "INTERNAL_AUTH_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(
    new URL(path, `${baseUrl.replace(/\/+$/, "")}/`),
    {
      method,
      headers: {
        "x-internal-token": INTERNAL_TOKEN,
        ...(body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...headers,
      },

      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),

      signal: AbortSignal.timeout(15000),
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid upstream JSON response");
  }

  return {
    status: response.status,
    data,
  };
}

function upstreamError(res, error) {
  console.error(
    "Gateway upstream error:",
    error.message
  );

  const status =
    error.code === "INTERNAL_AUTH_NOT_CONFIGURED"
      ? 503
      : error.name === "TimeoutError" ||
          error.name === "AbortError"
        ? 504
        : 502;

  return res.status(status).json({
    success: false,
    code:
      status === 504
        ? "UPSTREAM_TIMEOUT"
        : status === 503
          ? "INTERNAL_AUTH_NOT_CONFIGURED"
          : "UPSTREAM_SERVICE_ERROR",
    message:
      status === 504
        ? "Backend service timed out"
        : "Backend service is unavailable",
  });
}

// ==================================================
// 7. CREATE ORDER
// ==================================================

// POST /api/orders

app.post(
  "/api/orders",
  express.json({ limit: "100kb" }),
  async (req, res) => {
    const userId = getAuthenticatedUserId(req, res);

    if (userId === null) return;

    const idempotencyKey = req.get("Idempotency-Key");

    if (
      !idempotencyKey ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "Valid Idempotency-Key is required",
      });
    }

    if (
      !Array.isArray(req.body?.items) ||
      req.body.items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORDER_ITEMS",
        message: "Order items are required",
      });
    }

    try {
      const result = await callInternalService(
        ORDER_URL,
        "/api/orders",
        {
          method: "POST",
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
          body: {
            customerAuthUserId: userId,
            items: req.body.items,
          },
        }
      );

      return res.status(result.status).json(result.data);
    } catch (error) {
      return upstreamError(res, error);
    }
  }
);

// ==================================================
// 8. VERIFY ORDER OWNERSHIP
// ==================================================

async function loadOwnedOrder(req, res, orderId) {
  const userId = getAuthenticatedUserId(req, res);

  if (userId === null) return null;

  if (!/^[1-9]\d*$/.test(orderId)) {
    res.status(400).json({
      success: false,
      code: "INVALID_ORDER_ID",
      message: "Invalid Order ID",
    });

    return null;
  }

  const result = await callInternalService(
    ORDER_URL,
    `/api/orders/${orderId}`
  );

  if (result.status !== 200) {
    res.status(result.status).json(result.data);
    return null;
  }

  const order = result.data?.data;

  if (
    !order ||
    Number(order.customer_auth_user_id) !== userId
  ) {
    res.status(403).json({
      success: false,
      code: "ORDER_ACCESS_DENIED",
      message: "You cannot access this order",
    });

    return null;
  }

  return order;
}

// ==================================================
// 9. GET ORDER
// ==================================================

// GET /api/orders/:orderId

app.get("/api/orders/:orderId", async (req, res) => {
  try {
    const order = await loadOwnedOrder(
      req,
      res,
      req.params.orderId
    );

    if (!order) return;

    return res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    return upstreamError(res, error);
  }
});

// ==================================================
// 10. GET SHIPMENT
// ==================================================

// GET /api/shipments/order/:orderId

app.get(
  "/api/shipments/order/:orderId",
  async (req, res) => {
    try {
      const order = await loadOwnedOrder(
        req,
        res,
        req.params.orderId
      );

      if (!order) return;

      const result = await callInternalService(
        SHIPMENT_URL,
        `/api/shipments/order/${req.params.orderId}`
      );

      return res.status(result.status).json(result.data);
    } catch (error) {
      return upstreamError(res, error);
    }
  }
);

// ==================================================
// 11. 404 HANDLER
// ==================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: "ROUTE_NOT_FOUND",
    message: "Route not found",
  });
});

// ==================================================
// 12. ERROR HANDLER
// ==================================================

app.use((error, req, res, next) => {
  console.error("Gateway error:", error.message);

  const status =
    error.status === 400 || error.status === 413
      ? error.status
      : 500;

  return res.status(status).json({
    success: false,
    code:
      status === 400
        ? "INVALID_JSON"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : "INTERNAL_SERVER_ERROR",
    message:
      status === 500
        ? "Internal server error"
        : "Invalid request",
  });
});

// ==================================================
// 13. START SERVER
// ==================================================

app.listen(port, () => {
  console.log(
    `API Gateway listening at http://localhost:${port}`
  );
});
