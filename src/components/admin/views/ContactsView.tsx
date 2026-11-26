"use client";

import { SkeletonInbox } from "../Skeletons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CheckCheck, Mail, RefreshCw, Search, Trash2 } from "lucide-react";
import { deleteRow, selectRows, updateRow, type ContactMessage } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { dateText } from "../utils";
import { confirmModal } from "../ConfirmDialog";

type ContactFilter = "all" | ContactMessage["status"];

const FILTERS: { id: ContactFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "new", label: "Novas" },
  { id: "read", label: "Lidas" },
  { id: "replied", label: "Respondidas" },
  { id: "archived", label: "Arquivadas" },
];

export function ContactsView() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContactFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await selectRows<ContactMessage>("contact_messages", {
        order: "created_at.desc",
        limit: "200",
      });
      setMessages(data);
      setSelectedId((current) => {
        if (current && data.some((item) => item.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar as mensagens.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const counts = useMemo(() => {
    const map: Record<ContactFilter, number> = {
      all: messages.length,
      new: 0,
      read: 0,
      replied: 0,
      archived: 0,
    };
    for (const msg of messages) {
      map[msg.status] = (map[msg.status] ?? 0) + 1;
    }
    return map;
  }, [messages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return messages.filter((msg) => {
      if (filter !== "all" && msg.status !== filter) return false;
      if (!query) return true;
      return (
        msg.name.toLowerCase().includes(query) ||
        msg.email.toLowerCase().includes(query) ||
        msg.message.toLowerCase().includes(query)
      );
    });
  }, [messages, filter, search]);

  const selected = useMemo(
    () => filtered.find((msg) => msg.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  async function patchStatus(msg: ContactMessage, status: ContactMessage["status"]) {
    setBusyId(msg.id);
    setError("");
    try {
      const updated = await updateRow<ContactMessage>("contact_messages", msg.id, { status });
      const next = updated[0] ?? { ...msg, status };
      setMessages((current) => current.map((item) => (item.id === msg.id ? next : item)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o status.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSelect(msg: ContactMessage) {
    setSelectedId(msg.id);
    if (msg.status === "new") {
      await patchStatus(msg, "read");
    }
  }

  async function handleDelete(msg: ContactMessage) {
    const ok = await confirmModal({
      title: "Excluir mensagem",
      message: `Tem certeza que deseja excluir a mensagem de "${msg.name}"?`,
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    setBusyId(msg.id);
    setError("");
    try {
      await deleteRow("contact_messages", msg.id);
      setMessages((current) => {
        const remaining = current.filter((item) => item.id !== msg.id);
        if (selectedId === msg.id) {
          setSelectedId(remaining[0]?.id ?? null);
        }
        return remaining;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir a mensagem.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">ATENDIMENTO DO SITE</p>
          <h1>Mensagens de Contato</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-secondary" onClick={() => void loadMessages()} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="search"
            className="admin-search"
            placeholder="Buscar por nome, e-mail ou mensagem..."
            value={search}
            onChange={(event) => setSearch(event.target.value)} id="admin-views-contactsview-156"
          />
        </div>

        <div className="admin-filter-pills admin-toolbar-right">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-pill${filter === item.id ? " active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label} ({counts[item.id]})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonInbox />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhuma mensagem encontrada</strong>
          <p>Não há mensagens de contato para o filtro ou busca selecionada.</p>
        </div>
      ) : (
        <div className="admin-inbox">
          <div className="admin-inbox-list">
            {filtered.map((msg) => {
              const isSelected = selected?.id === msg.id;
              return (
                <button
                  key={msg.id}
                  type="button"
                  className={`admin-inbox-item admin-data-enter${isSelected ? " selected" : ""}`}
                  onClick={() => void handleSelect(msg)}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: msg.status === "new" ? 700 : 600 }}>
                      {msg.name}
                    </strong>
                    <AdminStatusBadge status={msg.status} />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>{msg.email}</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--admin-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.message}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--admin-muted)" }}>
                    {dateText(msg.created_at, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="admin-inbox-detail">
            {selected ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>{selected.name}</h2>
                    <p style={{ fontSize: 13, color: "var(--admin-muted)", marginTop: 4 }}>
                      {selected.email} • {dateText(selected.created_at, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <AdminStatusBadge status={selected.status} />
                </div>

                <div
                  style={{
                    padding: 16,
                    borderRadius: 6,
                    background: "var(--admin-soft)",
                    border: "1px solid var(--admin-line)",
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selected.message}
                </div>

                <div
                  className="admin-inbox-actions"
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: "auto" }}
                >
                  <a
                    className="admin-primary"
                    href={`mailto:${selected.email}?subject=${encodeURIComponent(`Re: Contato pelo site - ${selected.name}`)}`}
                  >
                    <Mail size={15} /> Responder por e-mail
                  </a>

                  {selected.status !== "replied" && (
                    <button
                      type="button"
                      className="admin-secondary"
                      disabled={busyId === selected.id}
                      onClick={() => void patchStatus(selected, "replied")}
                    >
                      <CheckCheck size={15} /> Marcar respondida
                    </button>
                  )}

                  {selected.status !== "archived" && (
                    <button
                      type="button"
                      className="admin-secondary"
                      disabled={busyId === selected.id}
                      onClick={() => void patchStatus(selected, "archived")}
                    >
                      <Archive size={15} /> Arquivar
                    </button>
                  )}

                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={busyId === selected.id}
                    onClick={() => void handleDelete(selected)}
                  >
                    <Trash2 size={15} /> Excluir
                  </button>
                </div>
              </>
            ) : (
              <div className="admin-empty">
                <strong>Selecione uma mensagem</strong>
                <p>Clique em um contato na lista ao lado para ler os detalhes.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
