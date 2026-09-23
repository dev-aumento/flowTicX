import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyHoursRow } from "@/lib/work-hours-policy";
import { formatBreakdownAxisLabel, REQUIRED_DAILY_HOURS, type BreakdownPeriod } from "@/lib/work-hours-policy";
import { formatWorkZoneDateKey } from "@/lib/timezone";

const MONTH_BAR_WIDTH = 52;
const CHART_HEIGHT = 248;

type DailyBreakdownChartProps = {
  data: DailyHoursRow[];
  period: BreakdownPeriod;
};

function useEdgeScroll(scrollRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const onMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const edge = 56;
      const step = 10;
      if (x < edge) el.scrollLeft -= step;
      else if (x > rect.width - edge) el.scrollLeft += step;
    };

    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [enabled, scrollRef]);
}

export function DailyBreakdownChart({ data, period }: DailyBreakdownChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrollable = period === "month" && data.length > 7;
  const chartWidth = Math.max(data.length * MONTH_BAR_WIDTH, 640);
  const tickFormatter = (value: string) => formatBreakdownAxisLabel(value, period);

  const yMax = useMemo(() => {
    const peak = data.reduce((max, row) => Math.max(max, row.hours), 0);
    return Math.max(REQUIRED_DAILY_HOURS, Math.ceil(peak + 1), 4);
  }, [data]);

  useEdgeScroll(scrollRef, isScrollable);

  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const margin = { top: 28, right: 12, left: 4, bottom: 4 };

  if (!isScrollable) {
    return (
      <div className="w-full" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={data} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#9CA3AF" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              tickFormatter={tickFormatter}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
              formatter={(value: number, name: string) => {
                const label = name === "regularHours" ? "Regular" : "OT";
                return [`${value}h`, label];
              }}
              labelFormatter={(label: string) =>
                formatWorkZoneDateKey(label, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              }
            />
            <Legend
              verticalAlign="top"
              height={24}
              formatter={(value) => (value === "regularHours" ? "Regular" : "OT")}
            />
            <Bar dataKey="regularHours" stackId="hours" fill="#2563EB" />
            <Bar dataKey="overtimeHours" stackId="hours" fill="#F59E0B" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={() => scrollBy(-MONTH_BAR_WIDTH * 4)}
        className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 border border-gray-200 shadow-md flex items-center justify-center text-gray-600 hover:bg-gray-50"
        aria-label="Scroll chart left"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        onClick={() => scrollBy(MONTH_BAR_WIDTH * 4)}
        className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 border border-gray-200 shadow-md flex items-center justify-center text-gray-600 hover:bg-gray-50"
        aria-label="Scroll chart right"
      >
        <ChevronRight size={18} />
      </button>

      <div
        ref={scrollRef}
        className="funnel-h-scroll mx-10"
        style={{ height: CHART_HEIGHT }}
      >
        <BarChart
          width={chartWidth}
          height={CHART_HEIGHT}
          data={data}
          margin={margin}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            interval={0}
            tickFormatter={tickFormatter}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 12 }}
            formatter={(value: number, name: string) => {
              const label = name === "regularHours" ? "Regular" : "OT";
              return [`${value}h`, label];
            }}
            labelFormatter={(label: string) =>
              formatWorkZoneDateKey(label, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            }
          />
          <Legend
            verticalAlign="top"
            height={24}
            formatter={(value) => (value === "regularHours" ? "Regular" : "OT")}
          />
          <Bar dataKey="regularHours" stackId="hours" fill="#2563EB" />
          <Bar dataKey="overtimeHours" stackId="hours" fill="#F59E0B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </div>

      <p className="text-[10px] text-gray-400 mt-2 text-center">
        Use the arrows or hover near the left/right edges to view all {data.length} days
      </p>
    </div>
  );
}
