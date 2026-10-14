const customerServiceBaseUrl =
  process.env.CUSTOMER_SERVICE_BASE_URL || "http://localhost:3002";

export async function getCustomerByAuthUserId(authUserId) {
  const response = await fetch(
    `${customerServiceBaseUrl}/api/customers/${encodeURIComponent(authUserId)}`,
    { signal: AbortSignal.timeout(5000) }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Customer Service returned HTTP ${response.status}`);
  }

  return response.json();
}
