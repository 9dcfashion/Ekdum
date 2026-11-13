"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { TrendPoint } from "@/lib/reports/dashboard";
import { formatCompactINR, formatDayMonth } from "@/lib/reports/format";

/** Bars for up to this many days; a line for longer ranges. */
const MAX_BAR_DAYS = 31;

function TrendTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: TrendPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{formatDate(point.day)}</p>
      <p className="tabular text-sm font-medium">{formatINR(point.total_paise)}</p>
      <p className="tabular text-muted-foreground">
        {point.invoice_count} {point.invoice_count === 1 ? "bill" : "bills"}
      </p>
    </div>
  );
}

export function SalesTrendChart({ data }: { data: TrendPoint[] }) {
  const total = data.reduce((sum, d) => sum + d.total_paise, 0);
  const best = data.reduce<TrendPoint | null>((b, d) => (!b || d.total_paise > b.total_paise ? d : b), null);
  const first = data[0]?.day;
  const last = data[data.length - 1]?.day;
  const summary =
    first && last
      ? `Sales from ${formatDate(first)} to ${formatDate(last)}: ${formatINR(total)} in total.` +
        (best && best.total_paise > 0 ? ` Best day ${formatDate(best.day)} with ${formatINR(best.total_paise)}.` : "")
      : "Sales trend";

  const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />;
  const xAxis = (
    <XAxis
      dataKey="day"
      tickFormatter={formatDayMonth}
      tick={axis}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      interval="preserveStartEnd"
      minTickGap={16}
    />
  );
  const yAxis = (
    <YAxis tickFormatter={formatCompactINR} tick={axis} tickLine={false} axisLine={false} width={52} allowDecimals={false} />
  );

  return (
    <figure className="m-0">
      {/* Fixed height so the page does not jump while the chart mounts. */}
      <div className="h-64 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          {data.length <= MAX_BAR_DAYS ? (
            <BarChart {...common} barCategoryGap="20%">
              {grid}
              {xAxis}
              {yAxis}
              <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
              <Bar dataKey="total_paise" name="Sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart {...common}>
              {grid}
              {xAxis}
              {yAxis}
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
              <Line
                dataKey="total_paise"
                name="Sales"
                type="monotone"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Sales by day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sales</th>
            <th scope="col">Bills</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDate(d.day)}</th>
              <td>{formatINR(d.total_paise)}</td>
              <td>{d.invoice_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
