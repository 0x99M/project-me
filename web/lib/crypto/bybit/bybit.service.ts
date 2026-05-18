import { BybitGetCandlesRequest, BybitGetCandlesResponse, BybitGetTickersResponse, BybitTicker } from "./bybit.types";

const BYBIT_BASE_API = "https://api.bybit.com/v5/market";
const BYBIT_KLINE_API = `${BYBIT_BASE_API}/kline`;
const BYBIT_TICKERS_API = `${BYBIT_BASE_API}/tickers`;

export const bybitService = {
  getTickers: async (): Promise<BybitTicker[]> => {
    const query = `category=spot`;
    const response = await fetch(`${BYBIT_TICKERS_API}?${query}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch tickers from Bybit - ${response.statusText}`);
    }

    const data: BybitGetTickersResponse = await response.json();

    if (data.retCode !== 0) {
      throw new Error(`Failed to fetch tickers from Bybit - ${response.statusText}`);
    }

    return data.result.list;
  },

  getCandles: async (request: BybitGetCandlesRequest): Promise<BybitGetCandlesResponse> => {
    const symbol = request.symbol;
    const query = `category=spot&symbol=${symbol}USDT&interval=${request.interval}&limit=${request.limit}`;
    const response = await fetch(`${BYBIT_KLINE_API}?${query}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${symbol} candles from Bybit - ${response.statusText}`);
    }

    const data: BybitGetCandlesResponse = await response.json();

    if (data.retCode !== 0) {
      throw new Error(`Failed to fetch ${symbol} candles from Bybit - ${response.statusText}`);
    }

    return data;
  },
}