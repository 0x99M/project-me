"use client";

import { useEffect, useRef, useState } from "react";
import { BybitCandle } from "@/lib/crypto/bybit/bybit.types";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CandlestickSeries,
  UTCTimestamp,
  MouseEventParams,
} from "lightweight-charts";

type Props = {
  candles: BybitCandle[];
};

export default function CandlesView({ candles }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [isPriceRangeChangeEnabled, setIsPriceRangeChangeEnabled] =
    useState<boolean>(false);
  const [priceRangeChange, setPriceRangeChange] = useState<number>(0);
  const [lineY, setLineY] = useState<number | null>(null);
  const [linePrice, setLinePrice] = useState<number | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: {
          color: "rgba(100, 100, 100, 0.0)",
        },
        horzLines: {
          color: "rgba(100, 100, 100, 0.0)",
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        visible: false,
      },
      crosshair: {
        mode: 2,
      },
      localization: {
        dateFormat: "yyyy-MM-dd",
      },
    });

    chartRef.current = chart;

    const GREEN = "#50FA7B";
    const RED = "#FF5555";
    const newSeries = chart.addSeries(CandlestickSeries, {
      upColor: GREEN,
      downColor: RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
      priceLineVisible: false,
    });

    candleSeriesRef.current = newSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      if (
        entries.length === 0 ||
        entries[0].target !== chartContainerRef.current
      )
        return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });

    resizeObserver.observe(chartContainerRef.current);

    return () => {
      if (chartContainerRef.current != null)
        resizeObserver.unobserve(chartContainerRef.current);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (chartContainerRef.current) {
        chartContainerRef.current.remove();
        chartContainerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setIsPriceRangeChangeEnabled(false);
    setPriceRangeChange(0);
    setLineY(null);
    setLinePrice(null);

    if (!candleSeriesRef.current || !candles) return;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
  }, [candles]);

  useEffect(() => {
    if (!chartContainerRef.current || !candles) return;

    const container = chartContainerRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const lastPrice = () => candles[candles.length - 1]?.close ?? 0;

    const onPointerDown = (e: PointerEvent) => {
      if (!isPriceRangeChangeEnabled) return;
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      setLineY(y);

      const price = series.coordinateToPrice(y);
      setLinePrice(price);
    };

    const onChartClick = (param: MouseEventParams) => {
      if (!isPriceRangeChangeEnabled) return;

      if (!param.point) {
        setPriceRangeChange(0);
        return;
      }

      const lp = lastPrice();
      if (!lp) return;

      const seriesPrice = series.coordinateToPrice(param.point.y) || 0;
      const pct = ((seriesPrice - lp) / lp) * 100;
      setPriceRangeChange(Number(pct.toFixed(2)));
    };

    container.addEventListener("pointerdown", onPointerDown);
    chart.subscribeClick(onChartClick);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      chart.unsubscribeClick(onChartClick);
    };
  }, [isPriceRangeChangeEnabled]);

  return (
    <div className="w-full flex flex-col justify-center items-center">
      <div
        onClick={() => {
          setIsPriceRangeChangeEnabled((enabled) => {
            const next = !enabled;
            if (!next) {
              setPriceRangeChange(0);
              setLineY(null);
              setLinePrice(null);
            }
            return next;
          });
        }}
        className={`${
          isPriceRangeChangeEnabled ? "text-white" : "text-gray-500"
        }`}
      >
        {priceRangeChange}%
      </div>
      <div ref={chartContainerRef} className="w-full aspect-square relative">
        {lineY !== null && (
          <>
            <div
              className="absolute left-0 right-0 h-0.5 border-t-1 border-dashed border-gray-500 pointer-events-none z-10 opacity-80"
              style={{ top: lineY }}
            />
            {linePrice !== null && (
              <div
                className="absolute text-white text-xs rounded pointer-events-none z-20"
                style={{
                  top: lineY - 9,
                  right: 0,
                  margin: "0 2px",
                  backgroundColor: "#282A36",
                  zIndex: 20,
                }}
              >
                {linePrice.toFixed(5)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

