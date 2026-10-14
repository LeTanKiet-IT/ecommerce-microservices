# Proposed Protocol Buffers contracts

These `.proto` files document **proposed** typed interfaces for the Ecommerce Microservices project:

- `auth.proto`: login and token verification.
- `customer.proto`: customer profile and membership lookup by score.
- `product.proto`: products and stock reservations.
- `order.proto`: create and look up orders.
- `shipment.proto`: look up shipments; conceptual order-created event.

**Current implementation:** services communicate synchronously through REST/HTTP and asynchronously through Apache Kafka. There is **no gRPC server, client, or protobuf serialization wired up**. Adding these contracts does not change or enable runtime gRPC or Kafka serialization.

For the marking rubric, you can explain the purpose and fields of these proposed schemas, but do not present them as implemented gRPC endpoints.

To actually implement gRPC later, install suitable protobuf/gRPC packages, generate or load contracts in the Node.js services, implement the RPC handlers and clients, configure network ports, and test end-to-end.
