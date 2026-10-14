import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

try {
  await productReservationClient.getReservation("TEST_NOT_FOUND");

  console.log("FAIL: Expected HTTP 404");
  process.exitCode = 1;
} catch (error) {
  console.log("HTTP:", error.status);
  console.log("CODE:", error.code);

  if (
    error.status === 404 &&
    error.code === "RESERVATION_NOT_FOUND"
  ) {
    console.log("PASS: Order Service GET Reservation");
  } else {
    console.log("FAIL: Unexpected error");
    process.exitCode = 1;
  }
}
