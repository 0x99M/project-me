export interface BybitGetTickersResponse {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    list: BybitTicker[];
  };
  retExtInfo: object;
  time: number;
}

export interface BybitTicker {
  symbol: string;
  bid1Price: string;
  bid1Size: string;
  ask1Price: string;
  ask1Size: string;
  lastPrice: string;
  prevPrice24h: string;
  price24hPcnt: string;
  highPrice24h: string;
  lowPrice24h: string;
  turnover24h: string;
  volume24h: string;
  usdIndexPrice: string;
}

export interface BybitGetCandlesRequest {
  symbol: string;
  interval: string;
  limit: number;
}

export interface BybitGetCandlesResponse {
  retCode: number;
  retMsg: string;
  result: {
    symbol: string;
    category: string;
    list: string[][];
  };
  retExtInfo: object;
  time: number;
}

export interface BybitCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}