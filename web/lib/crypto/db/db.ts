import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";

// Maintain compatibility with existing code that uses UserDoc
export type UserDoc = {
  _id: string; // Clerk userId (maps to id in database)
  email?: string;
  watchlist: string[]; // array of coin symbols, order = position
};

/**
 * Ensure a user exists in the database, creating one if needed
 */
export async function ensureUser(userId: string): Promise<UserDoc> {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (existing) {
    return {
      _id: existing.id,
      email: existing.email || undefined,
      watchlist: (existing.watchlist || []) as string[],
    };
  }

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({
      id: userId,
      watchlist: [],
    })
    .returning();

  return {
    _id: newUser.id,
    email: newUser.email || undefined,
    watchlist: (newUser.watchlist || []) as string[],
  };
}

/**
 * Get a user by their Clerk userId
 */
export async function getUser(userId: string): Promise<UserDoc | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) return null;

  return {
    _id: user.id,
    email: user.email || undefined,
    watchlist: (user.watchlist || []) as string[],
  };
}

/**
 * Update user's watchlist
 */
export async function updateUserWatchlist(
  userId: string,
  watchlist: string[]
): Promise<void> {
  await db
    .update(users)
    .set({
      watchlist,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Legacy function for compatibility - returns the users collection equivalent
 * This is kept for backward compatibility but uses DrizzleORM internally
 */
export async function getUsersCollection() {
  // Return a mock object that matches the MongoDB Collection interface
  // This should not be used directly, but kept for type compatibility
  return {
    findOne: async (query: { _id: string }) => {
      return getUser(query._id);
    },
    insertOne: async (doc: UserDoc) => {
      await db.insert(users).values({
        id: doc._id,
        email: doc.email,
        watchlist: doc.watchlist || [],
      });
    },
    updateOne: async (
      query: { _id: string },
      update: { $set: Partial<UserDoc> }
    ) => {
      if (update.$set.watchlist !== undefined) {
        await updateUserWatchlist(query._id, update.$set.watchlist);
      } else {
        await db
          .update(users)
          .set({
            email: update.$set.email,
            updatedAt: new Date(),
          })
          .where(eq(users.id, query._id));
      }
    },
  };
}
