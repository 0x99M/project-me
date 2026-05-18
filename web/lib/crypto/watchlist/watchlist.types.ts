export type WatchlistRow = {
  id: number;
  coin: string;
  position: number;
  created_at: string;
};

export type WatchlistInsert = {
  coin: string;
};

export type WatchlistUpdate = {
  id: number;
  position: number;
};

export type Sort = "position" | "gainers" | "losers" | "coin-asc" | "coin-desc";
