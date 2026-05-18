import { bybitService } from "@/lib/crypto/bybit/bybit.service";
import { BybitCandle, BybitGetCandlesRequest, BybitTicker } from "@/lib/crypto/bybit/bybit.types";
import { useQuery } from "@tanstack/react-query";

const bybitKeys = {
  tickers: ["tickers"] as const,
  candles: ["candles"] as const,
};

export function useBybitTickersMap() {
  return useQuery<Record<string, BybitTicker>, Error>({
    queryKey: bybitKeys.tickers,
    queryFn: async () => {
      const tickers = await bybitService.getTickers();
      return tickers
        .filter((t) => t.symbol.endsWith("USDT"))
        .reduce((acc, t) => {
          const correctedSymbol = t.symbol.replace(/USDT$/, "");
          acc[correctedSymbol] = { ...t, symbol: correctedSymbol };
          return acc;
        }, {} as Record<string, BybitTicker>);
    },
    staleTime: 1000 * 60 * 60,
  });
}

export function useBybitCandles(request: BybitGetCandlesRequest) {
  return useQuery<BybitCandle[], Error>({
    queryKey: [...bybitKeys.candles, request.symbol, request.interval],
    queryFn: async () => {
      const response = await bybitService.getCandles(request);
      return response.result.list.map((candle) => ({
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        time: parseInt(candle[0]) / 1000,
      })).reverse();
    },
    staleTime: 1000 * 60 * 60,
  });
}