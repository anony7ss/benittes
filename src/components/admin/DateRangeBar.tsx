"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { todayIso } from "./utils";

export type PeriodPreset = "all" | "today" | "7d" | "14d" | "30d" | "month" | "custom";

function shiftDaysBr(daysAgo: number): string {
  const now = new Date();
  const target = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return target.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function monthStartBr(): string {
  const t = todayIso();
  return `${t.slice(0, 8)}01`;
}

function formatShortDateBr(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(".", "");
}

function formatRangeLabel(preset: PeriodPreset, startDate: string, endDate: string): string {
  if (preset === "all" && !startDate && !endDate) return "Todo o período";
  if (startDate && endDate) {
    const year = endDate.slice(0, 4);
    if (startDate === endDate) {
      return `${formatShortDateBr(startDate)}, ${year}`;
    }
    return `${formatShortDateBr(startDate)} - ${formatShortDateBr(endDate)}, ${year}`;
  }
  if (startDate) return `A partir de ${formatShortDateBr(startDate)}`;
  if (endDate) return `Até ${formatShortDateBr(endDate)}`;
  return "Selecionar datas";
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface DateRangeBarProps {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
  onChange: (next: { preset: PeriodPreset; startDate: string; endDate: string }) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function DateRangeBar({ preset, startDate, endDate, onChange }: DateRangeBarProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [pickingEnd, setPickingEnd] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const initialCursor = useMemo(() => {
    const refIso = endDate || startDate || todayIso();
    const [y, m] = refIso.split("-").map(Number);
    return { year: y || new Date().getFullYear(), month: (m || new Date().getMonth() + 1) - 1 };
  }, [endDate, startDate]);

  const [cursor, setCursor] = useState(initialCursor);

  useEffect(() => {
    if (!customOpen) return;
    setCursor(initialCursor);
  }, [customOpen, initialCursor]);

  useEffect(() => {
    if (!customOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setCustomOpen(false);
        setPickingEnd(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCustomOpen(false);
        setPickingEnd(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [customOpen]);

  function handlePresetChange(nextPreset: PeriodPreset) {
    if (nextPreset === "custom") {
      setPickingEnd(false);
      setCustomOpen(true);
      onChange({ preset: "custom", startDate, endDate });
      return;
    }
    setCustomOpen(false);
    setPickingEnd(false);
    const today = todayIso();
    if (nextPreset === "all") {
      onChange({ preset: "all", startDate: "", endDate: "" });
    } else if (nextPreset === "today") {
      onChange({ preset: "today", startDate: today, endDate: today });
    } else if (nextPreset === "7d") {
      onChange({ preset: "7d", startDate: shiftDaysBr(6), endDate: today });
    } else if (nextPreset === "14d") {
      onChange({ preset: "14d", startDate: shiftDaysBr(13), endDate: today });
    } else if (nextPreset === "30d") {
      onChange({ preset: "30d", startDate: shiftDaysBr(29), endDate: today });
    } else if (nextPreset === "month") {
      onChange({ preset: "month", startDate: monthStartBr(), endDate: today });
    }
  }

  function handleDayClick(iso: string) {
    if (!pickingEnd || !startDate || iso < startDate) {
      onChange({ preset: "custom", startDate: iso, endDate: iso });
      setPickingEnd(true);
    } else {
      onChange({ preset: "custom", startDate, endDate: iso });
      setPickingEnd(false);
      setCustomOpen(false);
    }
  }

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const monthTitle = new Date(cursor.year, cursor.month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const today = todayIso();

  const cells: Array<{ iso: string; day: number } | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      iso: toIsoDate(cursor.year, cursor.month, i + 1),
    })),
  ];

  return (
    <div className="admin-date-range-wrap" ref={wrapRef}>
      <div className="admin-date-range-bar">
        <div className="admin-date-range-select-box">
          <select
            aria-label="Período"
            className="admin-date-range-select"
            value={preset}
            onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)} id="admin-daterangebar-161"
          >
            <option value="all">Todo o período</option>
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="14d">Últimos 14 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="month">Este mês</option>
            <option value="custom">Personalizado</option>
          </select>
          <ChevronDown size={14} className="admin-date-range-chevron" />
        </div>

        <button
          type="button"
          className="admin-date-range-trigger"
          onClick={() => setCustomOpen((v) => !v)}
          aria-expanded={customOpen}
        >
          <CalendarDays size={14} />
          <span>{formatRangeLabel(preset, startDate, endDate)}</span>
        </button>
      </div>

      {customOpen && (
        <div className="admin-date-range-popover" role="dialog" aria-label="Selecionar intervalo de datas">
          <div className="admin-date-cal-head">
            <button
              type="button"
              className="admin-date-cal-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Mês anterior"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="admin-date-cal-title">{monthTitle}</span>
            <button
              type="button"
              className="admin-date-cal-nav"
              onClick={() => shiftMonth(1)}
              aria-label="Próximo mês"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="admin-date-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="admin-date-cal-grid">
            {cells.map((cell, idx) => {
              if (!cell) return <span key={`empty-${idx}`} />;
              const isStart = startDate === cell.iso;
              const isEnd = endDate === cell.iso;
              const isInRange = Boolean(startDate && endDate && cell.iso > startDate && cell.iso < endDate);
              const isToday = cell.iso === today;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => handleDayClick(cell.iso)}
                  className={[
                    "admin-date-cal-day",
                    isStart || isEnd ? "selected" : "",
                    isInRange ? "in-range" : "",
                    isToday ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="admin-date-cal-foot">
            <span>{pickingEnd ? "Escolha a data final" : "Clique na data inicial"}</span>
            {(startDate || endDate) && (
              <button
                type="button"
                className="admin-link"
                onClick={() => {
                  setPickingEnd(false);
                  onChange({ preset: "all", startDate: "", endDate: "" });
                  setCustomOpen(false);
                }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
