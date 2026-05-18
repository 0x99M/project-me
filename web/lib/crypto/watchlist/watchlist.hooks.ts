import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { WatchlistInsert, WatchlistRow, WatchlistUpdate } from "./watchlist.types";
import { watchlistService } from "./watchlist.service";

const watchlistKeys = {
  all: ["watchlist"] as const,
};

export function useWatchlist() {
  return useQuery<WatchlistRow[], Error>({
    queryKey: watchlistKeys.all,
    queryFn: watchlistService.getAll,
    staleTime: 1000 * 60 * 60,
  });
}

export function useAddCoin() {
  const queryClient = useQueryClient();

  return useMutation<WatchlistRow, Error, WatchlistInsert>({
    mutationFn: watchlistService.create,
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useMoveCoin() {
  const queryClient = useQueryClient();

  return useMutation<WatchlistRow[], Error, WatchlistUpdate>({
    mutationFn: watchlistService.update,
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}

export function useDeleteCoin() {
  const queryClient = useQueryClient();

  return useMutation<WatchlistRow[], Error, number>({
    mutationFn: watchlistService.delete,
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: watchlistKeys.all });
    },
  });
}