import { randomUUID } from "node:crypto";
import { productReservationClient } from "./src/infrastructure/clients/product-reservation.client.js";

const reservationId = `GET_TEST_${randomUUID().replaceAll("-", "")}`;
const productId = "6ace8d5dc8c1450fa32654a1";

let reserved = false;
let failures = 0;

function check(condition, description) {
  console.log(condition ? "PASS:" : "FAIL:", description);
  if (!condition) failures++;
}

try {
  const reservation = await productReservationClient.reserveStock(
    reservationId,
    [{ productId, quantity: 1 }]
  );

  reserved = true;

  check(
    reservation.status === "RESERVED",
    "Reserve returns RESERVED"
  );

  const found = await productReservationClient.getReservation(
    reservationId
  );

  check(
    found.reservationId === reservationId &&
    found.status === "RESERVED" &&
    found.items.length === 1 &&
    found.items[0].productId === productId &&
    found.items[0].quantity === 1,
    "GET returns correct Reservation"
  );

} catch (error) {
  console.error("TEST ERROR:", error.code || error.message);
  failures++;
} finally {
  // Thử hoàn trả ngay cả khi phản hồi Reserve bị gián đoạn.
  // Khi đó Reservation có thể đã được tạo ở Product Service.
  try {
    const released = await productReservationClient.releaseStock(
      reservationId
    );

    check(
      released.status === "RELEASED",
      "Release returns RELEASED"
    );

    const foundAgain =
      await productReservationClient.getReservation(reservationId);

    check(
      foundAgain.status === "RELEASED",
      "GET returns RELEASED after release"
    );
  } catch (error) {
    if (
      !reserved &&
      error.code === "RESERVATION_NOT_FOUND"
    ) {
      console.log("INFO: No Reservation to release");
    } else {
      console.error(
        "CLEANUP ERROR:",
        error.code || error.message
      );
      console.error(
        "CHECK RESERVATION MANUALLY:",
        reservationId
      );
      failures++;
    }
  }
}

console.log("Reservation ID:", reservationId);
console.log("Failures:", failures);

if (failures === 0) {
  console.log("ALL TESTS PASSED");
} else {
  process.exitCode = 1;
}
