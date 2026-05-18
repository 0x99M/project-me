"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { BybitTicker } from "@/lib/crypto/bybit/bybit.types";

type Props = {
  tickers: BybitTicker[];
  value: string;
  onChange: (symbol: string) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
};

export function TickerSelect({ tickers, value, onChange, open, onOpenChange }: Props) {
  const [input, setInput] = useState("");

  return (
    <div className="w-full" >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full m-0 p-0">
            {value || "Select Ticker"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <Command>
            <CommandInput
              placeholder="Search ticker"
              value={input}
              onValueChange={setInput}
            />
            <CommandList>
              <CommandEmpty>
                {input.trim() ? "No ticker found" : "Start typing…"}
              </CommandEmpty>
              {tickers && tickers.length && input.trim() && (
                <CommandGroup>
                  {tickers.map((t) => (
                    <CommandItem
                      key={t.symbol}
                      value={t.symbol}
                      onSelect={() => {
                        onChange(t.symbol);
                        onOpenChange(false);
                      }}
                    >
                      {t.symbol}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

