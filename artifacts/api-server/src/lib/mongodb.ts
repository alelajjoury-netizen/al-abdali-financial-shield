import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | undefined;

export async function connectMongoDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  connectionPromise ??= mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  }).finally(() => {
    // Cache only an in-flight attempt, not a previously successful connection.
    connectionPromise = undefined;
  });

  await connectionPromise;
}

export const MONGODB_READINESS_TIMEOUT_MS = 2000;

/** Read-only probe: connection state alone cannot detect a broken live socket. */
export async function checkMongoDBReadiness(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("Database readiness deadline exceeded"));
    }, MONGODB_READINESS_TIMEOUT_MS);
  });

  const probe = async () => {
    await connectMongoDB();
    if (expired) return;
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database is unavailable");
    // Bound the driver operation as well as the whole connection + ping probe.
    await db.command({ ping: 1 }, { timeoutMS: MONGODB_READINESS_TIMEOUT_MS });
  };

  try {
    await Promise.race([probe(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
