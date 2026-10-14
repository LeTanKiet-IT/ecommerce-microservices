
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || "http://localhost:3003";

const TIMEOUT_MS = 10000;

// Gọi HTTP đến Product Service
async function requestProductService(
  path,
  body = null,
  method = "POST"
) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  if (!token) {
    throw new Error("INTERNAL_SERVICE_TOKEN is missing");
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {
    const headers = {
      "x-internal-token": token,
    };

    // GET không cần body hoặc Content-Type
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(
      `${PRODUCT_SERVICE_URL}${path}`,
      {
        method,
        headers,
        ...(method !== "GET"
          ? { body: JSON.stringify(body) }
          : {}),
        signal: controller.signal,
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        data?.message || "Product Service request failed"
      );

      error.status = response.status;
      error.code = data?.code || "PRODUCT_SERVICE_ERROR";

      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(
        "Product Service request timed out"
      );

      timeoutError.status = 503;
      timeoutError.code = "PRODUCT_SERVICE_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const productReservationClient = {
  // 1. Tra cứu Reservation theo ID
  async getReservation(reservationId) {
    return requestProductService(
      `/internal/stock-reservations/${encodeURIComponent(reservationId)}`,
      null,
      "GET"
    );
  },

  // 2. Giữ hàng
  async reserveStock(reservationId, items) {
    return requestProductService(
      "/internal/stock-reservations",
      {
        reservationId,
        items,
      }
    );
  },

  // 3. Xác nhận giữ hàng
  async confirmStock(reservationId, orderReference) {
    return requestProductService(
      `/internal/stock-reservations/${encodeURIComponent(reservationId)}/confirm`,
      {
        orderReference,
      }
    );
  },

  // 4. Hoàn trả tồn kho
  async releaseStock(reservationId) {
    return requestProductService(
      `/internal/stock-reservations/${encodeURIComponent(reservationId)}/release`,
      {}
    );
  },
};
