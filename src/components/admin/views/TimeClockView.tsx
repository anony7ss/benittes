"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Coffee, LogIn, LogOut, RefreshCw } from "lucide-react";
import type { PanelMember, Session } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { SkeletonBox, SkeletonTable } from "../Skeletons";
import { dateText, detail, todayIso, useModuleRecords } from "../utils";

type PunchType = "entrada" | "inicio_intervalo" | "fim_intervalo" | "saida";

const PUNCH_LABELS: Record<PunchType, string> = {
  entrada: "Entrada",
  inicio_intervalo: "Início intervalo",
  fim_intervalo: "Fim intervalo",
  saida: "Saída",
};

function calcWorkedMinutes(punches: Array<{ type: PunchType; at: string }>): number {
  const sorted = [...punches].sort((a, b) => a.at.localeCompare(b.at));
  let totalMs = 0;
  let activeStart: number | null = null;
  for (const p of sorted) {
    const t = new Date(p.at).getTime();
    if (!Number.isFinite(t)) continue;
    if (p.type === "entrada" || p.type === "fim_intervalo") {
      if (activeStart === null) activeStart = t;
    } else if (p.type === "inicio_intervalo" || p.type === "saida") {
      if (activeStart !== null && t >= activeStart) {
        totalMs += t - activeStart;
        activeStart = null;
      }
    }
  }
  return Math.round(totalMs / 60000);
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}`;
}

export function TimeClockView({
  session,
  member,
}: {
  session: Session;
  member: PanelMember;
}) {
  const { rows, loading, error, saveRecord, load } = useModuleRecords("settings", session.user.id);
  const [clock, setClock] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const today = todayIso();
  const myKey = `ponto-${session.user.id}-${today}`;

  const timeRecords = useMemo(
    () =>
      rows.filter(
        (r) => String(r.title ?? "").startsWith("ponto-") || detail(r, "tipo") === "ponto",
      ),
    [rows],
  );

  const myTodayRecord = useMemo(
    () => timeRecords.find((r) => r.title === myKey) ?? null,
    [timeRecords, myKey],
  );

  const myTodayPunches = useMemo(() => {
    const raw = myTodayRecord ? detail(myTodayRecord, "punches") : null;
    return Array.isArray(raw) ? (raw as Array<{ type: PunchType; at: string }>) : [];
  }, [myTodayRecord]);

  async function registerPunch(type: PunchType) {
    setSaving(true);
    try {
      const nextPunches = [...myTodayPunches, { type, at: new Date().toISOString() }];
      await saveRecord(myTodayRecord, {
        title: myKey,
        customer_name: member.full_name,
        status: type === "saida" ? "concluido" : "em_andamento",
        description: `${member.full_name} · ${today}`,
        details: {
          tipo: "ponto",
          date: today,
          user_id: session.user.id,
          member_name: member.full_name,
          punches: nextPunches,
        },
      });
    } finally {
      setSaving(false);
    }
  }

  const workedToday = calcWorkedMinutes(myTodayPunches);

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Ponto Eletrônico</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <section className="admin-panel" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
              Colaborador: <strong style={{ color: "var(--admin-ink)" }}>{member.full_name}</strong> · Hoje ({dateText(today)})
            </div>
            <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
              {clock || "--:--:--"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--admin-muted)", marginTop: 4 }}>
              Horas trabalhadas hoje:{" "}
              {loading ? (
                <span style={{ display: "inline-flex", verticalAlign: "middle" }}><SkeletonBox width={66} height={14} radius={4} /></span>
              ) : (
                <strong style={{ color: "var(--admin-ink)" }}>{formatDuration(workedToday)}</strong>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="admin-primary" disabled={saving} onClick={() => void registerPunch("entrada")}>
              <LogIn size={15} /> Entrada
            </button>
            <button type="button" className="admin-secondary" disabled={saving} onClick={() => void registerPunch("inicio_intervalo")}>
              <Coffee size={15} /> Início intervalo
            </button>
            <button type="button" className="admin-secondary" disabled={saving} onClick={() => void registerPunch("fim_intervalo")}>
              <Clock size={15} /> Fim intervalo
            </button>
            <button type="button" className="admin-secondary" disabled={saving} onClick={() => void registerPunch("saida")}>
              <LogOut size={15} /> Saída
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--admin-line)" }}>
            <SkeletonBox width={92} height={28} radius={6} />
            <SkeletonBox width={104} height={28} radius={6} />
          </div>
        ) : myTodayPunches.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--admin-line)" }}>
            {myTodayPunches.map((p, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--admin-line)",
                  background: "var(--admin-soft)",
                }}
              >
                <strong>{PUNCH_LABELS[p.type]}:</strong>{" "}
                {new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ))}
          </div>
        )}
      </section>

      {loading ? <SkeletonTable rows={4} /> : (
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Data</th>
              <th>Marcações</th>
              <th>Total trabalhado</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {timeRecords.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--admin-muted)", padding: 28 }}>
                  Nenhum registro de ponto lançado ainda.
                </td>
              </tr>
            ) : (
              timeRecords.map((row) => {
                const rawPunches = detail(row, "punches");
                const punches = Array.isArray(rawPunches)
                  ? (rawPunches as Array<{ type: PunchType; at: string }>)
                  : [];
                const mins = calcWorkedMinutes(punches);
                return (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 600 }}>
                      {String(detail(row, "member_name") ?? row.customer_name ?? "Colaborador")}
                    </td>
                    <td>{dateText(String(detail(row, "date") ?? row.created_at))}</td>
                    <td style={{ fontSize: 12 }}>
                      {punches
                        .map(
                          (p) =>
                            `${PUNCH_LABELS[p.type]} ${new Date(p.at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`,
                        )
                        .join(" · ") || "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>{formatDuration(mins)}</td>
                    <td>
                      <AdminStatusBadge
                        status={row.status === "concluido" ? "concluido" : "em_andamento"}
                        label={row.status === "concluido" ? "Encerrado" : "Em expediente"}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
