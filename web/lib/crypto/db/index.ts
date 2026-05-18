import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Global connection instance for Next.js serverless environment
// This ensures connection reuse across function invocations
declare global {
  var postgresClient: postgres.Sql | undefined;
  var drizzleDb: PostgresJsDatabase<typeof schema> | undefined;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  // Return cached instance if available
  if (globalThis.drizzleDb) {
    return globalThis.drizzleDb;
  }

  // Get connection string - only check at runtime, not during build
  // During build time, this will be undefined but won't throw until actually used
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  // Create or reuse client connection
  const client =
    globalThis.postgresClient ??
    postgres(connectionString, {
      prepare: false, // Disable prepared statements for serverless compatibility
      max: 10, // Maximum number of connections in the pool
      idle_timeout: 20, // Close idle connections after 20 seconds
      connect_timeout: 10, // Connection timeout in seconds
      max_lifetime: 60 * 30, // Maximum connection lifetime (30 minutes)
    });

  // Store client in global for connection reuse across serverless function invocations
  if (!globalThis.postgresClient) {
    globalThis.postgresClient = client;
  }

  // Create and cache Drizzle instance
  const db = drizzle(client, { schema });
  globalThis.drizzleDb = db;

  return db;
}

// Export db as a lazy getter that only initializes when first accessed
// This prevents the connection from being created during build time
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const dbInstance = getDb();
    const value = dbInstance[prop as keyof PostgresJsDatabase<typeof schema>];
    // If it's a function, bind it to the db instance to preserve 'this' context
    if (typeof value === "function") {
      return value.bind(dbInstance);
    }
    return value;
  },
}) as PostgresJsDatabase<typeof schema>;

// Export schema for use in other files
export { schema };

// Export types for convenience
export type { User, NewUser } from "./schema";
