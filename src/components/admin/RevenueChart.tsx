"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { money } from "./utils";

export type ChartPoint = {
  month: string;
  value: number;
  label: string;
};

export type RevenuePeriod = 3 | 6 | 12;

function formatCompactAxis(val: number): string {
  if (val <= 0) return "0";
  if (val >= 1000) {
    const k = val / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(val));
}

export function RevenueChart({
  data,
  period = 6,
  onPeriodChange,
}: {
  data: ChartPoint[];
  period?: RevenuePeriod;
  onPeriodChange?: (next: RevenuePeriod) => void;
}) {
  const gradId = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = data.reduce((acc, item) => acc + item.value, 0);
  const hasRevenue = data.some((d) => d.value > 0);
  const lastVal = data.length >= 1 ? data[data.length - 1].value : 0;
  const prevVal = data.length >= 2 ? data[data.length - 2].value : 0;
  const deltaPct =
    prevVal > 0
      ? ((lastVal - prevVal) / prevVal) * 100
      : lastVal > 0
        ? 100
        : 0;
  const isPositive = deltaPct >= 0;

  const width = 620;
  const height = 240;
  const padLeft = 42;
  const padRight = 22;
  const padTop = 18;
  const padBottom = 30;
  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;
  const rawMax = Math.max(100, ...data.map((d) => d.value));
  const maxVal = Math.ceil(rawMax * 1.15);

  const coords = data.map((d, i) => {
    const x =
      data.length <= 1
        ? padLeft + usableW / 2
        : padLeft + (i / (data.length - 1)) * usableW;
    const y = padTop + usableH - (d.value / maxVal) * usableH;
    return { x, y, ...d };
  });

  const linePath = coords.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = coords[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");

  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1].x} ${height - padBottom} L ${coords[0].x} ${height - padBottom} Z`
      : "";

  const activePoint = hoveredIdx !== null ? coords[hoveredIdx] : null;
  const yTicks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <TooltipProvider delayDuration={60}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <motion.div
              key={activePoint ? activePoint.month : `total-${period}`}
              initial={{ opacity: 0.7, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {activePoint ? activePoint.label : money(total)}
            </motion.div>
            <div style={{ fontSize: 12, color: "var(--admin-muted)", marginTop: 4 }}>
              {activePoint
                ? `Faturamento em ${activePoint.month}`
                : `Acumulado nos últimos ${period} meses`}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {hasRevenue && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: isPositive ? "var(--admin-green)" : "var(--admin-red)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {deltaPct >= 0 ? "+" : ""}
                {deltaPct.toFixed(1)}%{" "}
                <span style={{ color: "var(--admin-muted)", fontWeight: 400 }}>
                  vs mês anterior
                </span>
              </span>
            )}

            {onPeriodChange && (
              <div className="admin-filter-pills" role="group" aria-label="Período do gráfico">
                {([3, 6, 12] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`admin-pill ${period === p ? "active" : ""}`}
                    onClick={() => onPeriodChange(p)}
                  >
                    {p}M
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {!hasRevenue ? (
          <div
            style={{
              height: 228,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "24px 0",
              color: "var(--admin-muted)",
            }}
          >
            <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
              <strong style={{ fontSize: 13.5, color: "var(--admin-ink)" }}>
                Nenhum faturamento registrado nos últimos {period} meses
              </strong>
              <span style={{ fontSize: 12 }}>
                Ordens de serviço e vendas concluídas aparecerão automaticamente aqui.
              </span>
            </div>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: "100%", height: 236, overflow: "visible", display: "block" }}
            role="img"
            aria-label={`Faturamento dos últimos ${period} meses`}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--admin-green)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--admin-green)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {yTicks.map((t) => {
              const y = padTop + usableH * (1 - t);
              return (
                <g key={t}>
                  <text
                    x={padLeft - 10}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="var(--admin-muted)"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatCompactAxis(maxVal * t)}
                  </text>
                  <line
                    x1={padLeft}
                    x2={width - padRight}
                    y1={y}
                    y2={y}
                    stroke="var(--admin-line)"
                    strokeOpacity={0.5}
                  />
                </g>
              );
            })}

            {areaPath && (
              <motion.path
                d={areaPath}
                fill={`url(#${gradId})`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.55, ease: "easeOut" }}
              />
            )}

            {linePath && (
              <motion.path
                d={linePath}
                fill="none"
                stroke="var(--admin-green)"
                strokeWidth={2.2}
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              />
            )}

            {activePoint && (
              <motion.line
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padTop}
                y2={height - padBottom}
                stroke="var(--admin-green)"
                strokeOpacity={0.35}
              />
            )}

            {coords.map((pt, idx) => {
              const isHot = hoveredIdx === idx;
              return (
                <g key={pt.month}>
                  {/* Rótulo do mês alinhado exatamente ao ponto X */}
                  <text
                    x={pt.x}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={isHot ? 600 : 400}
                    fill={isHot ? "var(--admin-ink)" : "var(--admin-muted)"}
                    style={{ textTransform: "uppercase" }}
                  >
                    {pt.month}
                  </text>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <g
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        style={{ cursor: "pointer" }}
                      >
                        <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" />
                        <motion.circle
                          cx={pt.x}
                          cy={pt.y}
                          initial={{ scale: 0 }}
                          animate={{ scale: isHot ? 1.55 : 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 24 }}
                          r={3.4}
                          fill={isHot ? "var(--admin-green)" : "var(--admin-card)"}
                          stroke="var(--admin-green)"
                          strokeWidth={2}
                          opacity={isHot || pt.value > 0 ? 1 : 0.45}
                        />
                      </g>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div style={{ display: "grid", gap: 2 }}>
                        <span
                          style={{
                            color: "var(--admin-muted)",
                            fontSize: 11,
                            textTransform: "uppercase",
                          }}
                        >
                          {pt.month}
                        </span>
                        <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                          {pt.label}
                        </strong>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </TooltipProvider>
  );
}
