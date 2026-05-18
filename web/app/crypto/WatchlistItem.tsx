import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { BybitTicker } from "@/lib/crypto/bybit/bybit.types";
import { formatCompact } from "@/lib/crypto/shared/numbers.utils";
import { ArrowUpToLine, StarOff } from "lucide-react";

type Props = {
  ticker: BybitTicker | undefined;
  onRemove: () => void;
  onMoveToTop: () => void;
};

export function WatchlistItem({ ticker, onRemove, onMoveToTop }: Props) {

  if (!ticker) return null;

  const symbol = ticker.symbol;
  const change = parseFloat(ticker.price24hPcnt || "0") * 100;
  const color = change > 0 ? "text-custom-green" : "text-custom-red";
  const volume = parseFloat(ticker.volume24h || "0") * parseFloat(ticker.lastPrice || "0");

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className="flex items-center justify-between" >
          <div className="flex flex-col gap-1" >
            <p>{symbol}<span className="text-white/30 text-sm" > / USDT</span></p>
            <p className="text-white/30 text-sm" >{formatCompact(volume)} USDT</p>
          </div>
          <p className={`${color} tracking-wide`}>{change.toFixed(2)}%</p>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onClick={(e) => e.stopPropagation()}
        className="h-12 w-20 flex justify-center items-center gap-4"
      >
        <Button
          variant="ghost"
          className="h-4 w-4 m-0 p-0"
          onClick={onMoveToTop}
        >
          <ArrowUpToLine />
        </Button>
        <Button
          variant="ghost"
          className="h-4 w-4 m-0 p-0"
          onClick={onRemove}
        >
          <StarOff />
        </Button>
      </ContextMenuContent>
    </ContextMenu>
  );
}

