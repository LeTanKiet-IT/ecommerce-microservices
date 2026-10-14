const productServiceBaseUrl =
  process.env.PRODUCT_SERVICE_BASE_URL || "http://localhost:3003";

export async function getProductById(productId) {
  const response = await fetch(
    `${productServiceBaseUrl}/api/products/${encodeURIComponent(productId)}`,
    { signal: AbortSignal.timeout(5000) }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Product Service returned HTTP ${response.status}`);
  }

  return response.json();
}
