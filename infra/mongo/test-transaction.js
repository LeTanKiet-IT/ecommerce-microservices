const database = db.getSiblingDB("product_db");
const collection = database.getCollection("transaction_tests");
const testId = new ObjectId();

const session = db.getMongo().startSession();

try {
  const sessionCollection = session
    .getDatabase("product_db")
    .getCollection("transaction_tests");

  session.startTransaction();

  sessionCollection.insertOne({
    _id: testId,
    testName: "COMMIT_TEST",
    createdAt: new Date()
  });

  session.commitTransaction();

  const saved = collection.findOne({ _id: testId });

  if (!saved) {
    throw new Error("Commit test failed");
  }

  print("TEST 1 PASS: Transaction COMMIT");

  session.startTransaction();

  sessionCollection.insertOne({
    _id: new ObjectId(),
    testName: "ABORT_TEST",
    createdAt: new Date()
  });

  session.abortTransaction();

  const aborted = collection.findOne({
    testName: "ABORT_TEST"
  });

  if (aborted) {
    throw new Error("Abort test failed");
  }

  print("TEST 2 PASS: Transaction ABORT");
} catch (error) {
  print("TEST FAILED: " + error.message);

  try {
    session.abortTransaction();
  } catch (_) {}

  throw error;
} finally {
  session.endSession();
  collection.deleteOne({ _id: testId });
  collection.deleteMany({ testName: "ABORT_TEST" });
  print("Test data cleaned up");
}
