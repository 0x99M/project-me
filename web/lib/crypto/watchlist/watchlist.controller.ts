import { ensureUser, updateUserWatchlist } from "@/lib/crypto/db/db";
import { auth } from "@clerk/nextjs/server";
import {
  WatchlistInsert,
  WatchlistRow,
  WatchlistUpdate,
} from "./watchlist.types";

function mapToRows(coins: string[]): WatchlistRow[] {
  return coins.map((coin, i) => ({
    id: i + 1,
    coin,
    position: i + 1,
    created_at: new Date().toISOString(), // placeholder; UI does not use it
  }));
}

async function getAll() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = await ensureUser(userId);
  const coins = user.watchlist || [];
  return Response.json(mapToRows(coins));
}

async function create(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: WatchlistInsert = await req.json();
  if (!body?.coin)
    return Response.json({ error: "Missing coin" }, { status: 400 });

  const user = await ensureUser(userId);

  const coins = user.watchlist || [];
  if (!coins.includes(body.coin)) coins.push(body.coin);

  await updateUserWatchlist(userId, coins);

  // return the newly added item as row
  const index = coins.indexOf(body.coin);
  const row: WatchlistRow = {
    id: index + 1,
    coin: body.coin,
    position: index + 1,
    created_at: new Date().toISOString(),
  };

  return Response.json(row, { status: 201 });
}

async function update(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body: WatchlistUpdate = await req.json();
  const { id } = params;
  const { position } = body;

  if (!id || position === undefined)
    return Response.json(
      { error: "Missing required fields: id (from URL) and position" },
      { status: 400 }
    );

  const user = await ensureUser(userId);
  const coins = (user.watchlist || []).slice();

  const fromIndex = Math.max(0, parseInt(id) - 1);
  if (fromIndex < 0 || fromIndex >= coins.length)
    return Response.json({ error: "Item not found" }, { status: 404 });

  const [coin] = coins.splice(fromIndex, 1);
  const toIndex = Math.max(0, Math.min(coins.length, position - 1));
  coins.splice(toIndex, 0, coin);

  // overwrite the array as requested
  await updateUserWatchlist(userId, coins);

  return Response.json(mapToRows(coins));
}

export async function deleteItem({ params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = params;
  if (!id) {
    return Response.json(
      { error: "Missing required field: id (from URL)" },
      { status: 400 }
    );
  }

  const user = await ensureUser(userId);
  const coins = (user.watchlist || []).slice();

  const index = Math.max(0, parseInt(id) - 1);
  if (index < 0 || index >= coins.length)
    return Response.json({ error: "Item not found" }, { status: 404 });

  coins.splice(index, 1);

  await updateUserWatchlist(userId, coins);

  return Response.json(mapToRows(coins));
}

export const watchlistController = {
  GET: getAll,
  POST: create,
  PUT: update,
  DELETE: deleteItem,
} as const;
