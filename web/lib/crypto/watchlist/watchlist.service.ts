import { WatchlistInsert, WatchlistRow, WatchlistUpdate } from "./watchlist.types";

const WATCHLIST_API = "/api/watchlist";

export const watchlistService = {
  getAll: async (): Promise<WatchlistRow[]> => {
    const response = await fetch(`${WATCHLIST_API}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch tickres - ${response.statusText}`);
    }

    return response.json();
  },

  create: async (coin: WatchlistInsert): Promise<WatchlistRow> => {
    const response = await fetch(`${WATCHLIST_API}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coin),
    });

    if (!response.ok) {
      throw new Error(`Failed to create coin - ${response.statusText}`);
    }

    return response.json();
  },

  update: async (coin: WatchlistUpdate): Promise<WatchlistRow[]> => {
    const response = await fetch(`${WATCHLIST_API}/${coin.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coin),
    });

    if (!response.ok) {
      throw new Error(`Failed to update coin - ${response.statusText}`);
    }

    return response.json();
  },

  delete: async (id: number): Promise<WatchlistRow[]> => {
    const response = await fetch(`${WATCHLIST_API}/${id}`, { method: "DELETE" });

    if (!response.ok) {
      throw new Error(`Failed to delete coin - ${response.statusText}`);
    }

    return response.json();
  },
}