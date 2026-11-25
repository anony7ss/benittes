"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { money } from "./utils";

export type CashflowPoint = {
  label: string;
  inflow: number;
  outflow: number;
};

export type TrendPoint = {
  label: string;
  value: number;
  count?: number;
};

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
  count?: number;
};

export function CashflowBarChart({ data }: { data: CashflowPoint[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxVal = Math.max(1, ...data.flatMap((d) => [d.inflow, d.outflow]));

  return (
    <TooltipProvider delayDuration={60}>
      <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 12,
          color: "var(--admin-muted)",
          marginBottom: 14,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: "#22c55e" }} />
          Entradas
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: "#ef4444" }} />
          Saídas
        </span>
      </div>

      <div
        style={{
          position: "relative",
          height: 190,
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`,
          gap: 10,
          alignItems: "end",
          paddingTop: 12,
          borderBottom: "1px solid var(--admin-line)",
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((step) => (
          <div
            key={step}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${step * 100}%`,
              borderTop: "1px dashed var(--admin-line)",
              opacity: 0.55,
              pointerEvents: "none",
            }}
          />
        ))}

        {data.map((point, idx) => {
          const inPct = point.inflow > 0 ? Math.max(6, Math.round((point.inflow / maxVal) * 100)) : 2;
          const outPct = point.outflow > 0 ? Math.max(6, Math.round((point.outflow / maxVal) * 100)) : 2;
          const isHovered = hoveredIdx === idx;
          return (
            <Tooltip key={point.label}>
              <TooltipTrigger asChild>
                <div
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    opacity: hoveredIdx === null || isHovered ? 1 : 0.5,
                    transition: "opacity 140ms ease",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      flex: 1,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      gap: 5,
                      padding: "0 4px",
                    }}
                  >
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${inPct}%` }}
                      transition={{ duration: 0.5, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        width: "42%",
                        maxWidth: 18,
                        borderRadius: "6px 6px 2px 2px",
                        background: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
                        opacity: point.inflow > 0 ? 1 : 0.22,
                      }}
                    />
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${outPct}%` }}
                      transition={{ duration: 0.5, delay: idx * 0.04 + 0.05, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        width: "42%",
                        maxWidth: 18,
                        borderRadius: "6px 6px 2px 2px",
                        background: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)",
                        opacity: point.outflow > 0 ? 1 : 0.22,
                      }}
                    />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div style={{ display: "grid", gap: 3, fontVariantNumeric: "tabular-nums" }}>
                  <strong style={{ fontSize: 11.5 }}>{point.label}</strong>
                  <span style={{ color: "var(--admin-green)" }}>Entradas: +{money(point.inflow)}</span>
                  <span style={{ color: "var(--admin-red)" }}>Saídas: -{money(point.outflow)}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))`,
          gap: 10,
          marginTop: 8,
        }}
      >
        {data.map((point, idx) => (
          <span
            key={point.label}
            style={{
              textAlign: "center",
              fontSize: 11.5,
              color: hoveredIdx === idx ? "var(--admin-ink)" : "var(--admin-muted)",
              fontWeight: hoveredIdx === idx ? 600 : 400,
            }}
          >
            {point.label}
          </span>
        ))}
      </div>
      </div>
    </TooltipProvider>
  );
}

export function AreaTrendChart({
  data,
  subtitle = "Evolução no período",
}: {
  data: TrendPoint[];
  subtitle?: string;
}) {
  const gradId = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = data.reduce((acc, d) => acc + d.value, 0);
  const firstVal = data.length >= 1 ? data[0].value : 0;
  const lastVal = data.length >= 1 ? data[data.length - 1].value : 0;
  const deltaPct =
    firstVal > 0
      ? ((lastVal - firstVal) / firstVal) * 100
      : lastVal > 0
        ? 100
        : 0;
  const isPositive = deltaPct >= 0;

  const width = 540;
  const height = 185;
  const padLeft = 44;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 14;
  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;
  const maxVal = Math.max(100, Math.ceil(Math.max(1, ...data.map((d) => d.value)) * 1.15));

  const coords = data.map((d, i) => {
    const x = data.length <= 1 ? padLeft + usableW / 2 : padLeft + (i / (data.length - 1)) * usableW;
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
  const yTicks = [1, 0.66, 0.33, 0];

  const formatY = (val: number) => {
    if (val <= 0) return "0";
    if (val >= 1000) {
      const k = val / 1000;
      return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
    }
    return String(Math.round(val));
  };

  return (
    <TooltipProvider delayDuration={60}>
      <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {activePoint ? money(activePoint.value) : money(total)}
          </div>
          <div style={{ fontSize: 12, color: "var(--admin-muted)", marginTop: 4 }}>
            {activePoint
              ? `${activePoint.label}${activePoint.count !== undefined ? ` · ${activePoint.count} registro${activePoint.count === 1 ? "" : "s"}` : ""}`
              : subtitle}
          </div>
        </div>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            fontWeight: 600,
            color: isPositive ? "var(--admin-green)" : "var(--admin-red)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{isPositive ? "↑" : "↓"}</span>
          {deltaPct >= 0 ? "+" : ""}
          {deltaPct.toFixed(1)}%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: 185, overflow: "visible", display: "block" }}
        role="img"
        aria-label="Gráfico de evolução"
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
                {formatY(maxVal * t)}
              </text>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="var(--admin-line)"
                strokeDasharray="4 4"
                strokeOpacity={0.75}
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
            transition={{ duration: 0.45 }}
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
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        )}

        {activePoint && (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={padTop}
            y2={height - padBottom}
            stroke="var(--admin-green)"
            strokeOpacity={0.45}
            strokeDasharray="3 3"
          />
        )}

        {coords.map((pt, idx) => {
          const isHot = hoveredIdx === idx;
          return (
            <Tooltip key={pt.label}>
              <TooltipTrigger asChild>
                <g
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                  <motion.circle
                    cx={pt.x}
                    cy={pt.y}
                    initial={{ scale: 0 }}
                    animate={{ scale: isHot ? 1.55 : 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 24 }}
                    r={3}
                    fill={isHot ? "var(--admin-green)" : "var(--admin-card)"}
                    stroke="var(--admin-green)"
                    strokeWidth={2}
                  />
                </g>
              </TooltipTrigger>
              <TooltipContent>
                <div style={{ display: "grid", gap: 2, fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ color: "var(--admin-muted)", fontSize: 11 }}>{pt.label}</span>
                  <strong>{money(pt.value)}</strong>
                  {pt.count !== undefined && (
                    <span style={{ fontSize: 11, color: "var(--admin-muted)" }}>
                      {pt.count} registro{pt.count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 11.5,
          color: "var(--admin-muted)",
          paddingLeft: 44,
          paddingRight: 10,
        }}
      >
        {data.map((d, idx) => (
          <span
            key={d.label}
            style={{
              color: hoveredIdx === idx ? "var(--admin-ink)" : undefined,
              fontWeight: hoveredIdx === idx ? 600 : undefined,
            }}
          >
            {d.label}
          </span>
        ))}
      </div>
      </div>
    </TooltipProvider>
  );
}

export function DonutBreakdownChart({
  slices,
  centerLabel,
  centerValue,
  emptyText = "Sem movimentações para exibir",
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  emptyText?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const nonZero = slices.filter((s) => s.value > 0);
  const total = nonZero.reduce((acc, s) => acc + s.value, 0);

  if (nonZero.length === 0 || total <= 0) {
    return (
      <div className="admin-empty" style={{ padding: "36px 12px" }}>
        <span>{emptyText}</span>
      </div>
    );
  }

  const size = 172;
  const strokeWidth = 22;
  const radius = (size - strokeWidth - 6) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulated = 0;
  const segments = nonZero.map((slice) => {
    const fraction = slice.value / total;
    const length = fraction * circumference;
    const offset = -accumulated;
    accumulated += length;
    return { ...slice, fraction, length, offset };
  });

  const activeSlice = hoveredIdx !== null ? segments[hoveredIdx] : null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
      }}
    >
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--admin-line)"
            strokeWidth={strokeWidth}
            opacity={0.35}
          />
          {segments.map((seg, idx) => {
            const isHot = hoveredIdx === idx;
            return (
              <motion.circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHot ? strokeWidth + 4 : strokeWidth}
                strokeDasharray={`${seg.length} ${circumference}`}
                strokeDashoffset={seg.offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                initial={{ opacity: 0, strokeDasharray: `0 ${circumference}` }}
                animate={{
                  opacity: hoveredIdx === null || isHot ? 1 : 0.4,
                  strokeDasharray: `${seg.length} ${circumference}`,
                }}
                transition={{ duration: 0.55, delay: idx * 0.06, ease: [0.22, 1, 0.36, 1] }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}
        </svg>

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            textAlign: "center",
            padding: 24,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--admin-muted)" }}>
              {activeSlice ? activeSlice.label : centerLabel}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
              {activeSlice ? money(activeSlice.value) : centerValue}
            </div>
            {activeSlice && (
              <div style={{ fontSize: 11, color: "var(--admin-muted)" }}>
                {Math.round(activeSlice.fraction * 100)}%
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, flex: "1 1 180px", minWidth: 180 }}>
        {segments.map((seg, idx) => {
          const pct = Math.round(seg.fraction * 100);
          const isHot = hoveredIdx === idx;
          return (
            <div
              key={seg.label}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "5px 8px",
                borderRadius: 8,
                cursor: "pointer",
                background: isHot ? "var(--admin-bg)" : "transparent",
                transition: "background 120ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: seg.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: isHot ? 600 : 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {seg.label}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--admin-muted)", flexShrink: 0 }}>
                <strong style={{ color: "var(--admin-ink)" }}>{money(seg.value)}</strong> · {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
