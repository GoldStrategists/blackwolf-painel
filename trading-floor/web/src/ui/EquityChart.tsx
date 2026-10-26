import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { EquityPoint } from '@bw/shared';

export function EquityChart({ points, field }: { points: EquityPoint[]; field: 'equity' | 'balance' }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#6b7a93', fontSize: 11 },
      grid: { vertLines: { color: '#131a26' }, horzLines: { color: '#131a26' } },
      rightPriceScale: { borderColor: '#1c2534' },
      timeScale: { borderColor: '#1c2534', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { locale: 'pt-BR', priceFormatter: (p: number) => p.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' }) },
    });
    series.current = c.addAreaSeries({ lineColor: '#2f7bff', topColor: 'rgba(47,123,255,0.35)', bottomColor: 'rgba(47,123,255,0.02)', lineWidth: 2 });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const seen = new Set<number>();
    const data: { time: UTCTimestamp; value: number }[] = [];
    for (const p of points) {
      const v = p[field];
      const t = Math.floor(p.ts / 1000);
      if (v == null || seen.has(t)) continue;
      seen.add(t);
      data.push({ time: t as UTCTimestamp, value: v });
    }
    data.sort((a, b) => a.time - b.time);
    const up = data.length < 2 || data[data.length - 1]!.value >= data[0]!.value;
    s.applyOptions({ lineColor: up ? '#1fd67a' : '#ff4053', topColor: up ? 'rgba(31,214,122,0.3)' : 'rgba(255,64,83,0.3)', bottomColor: 'rgba(0,0,0,0)' });
    s.setData(data);
    chart.current?.timeScale().fitContent();
  }, [points, field]);

  return <div ref={el} className="h-48 w-full" />;
}
