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
  });

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = undefined;
    throw error;
  }
}
