"use client";

import { SkeletonTable } from "../Skeletons";
import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, useModuleRecords, modalBackdropProps } from "../utils";

type ClientForm = {
  title: string;
  phone: string;
  customer_email: string;
  documento: string;
  contato_preferido: string;
  status: string;
  description: string;
};

const emptyForm: ClientForm = {
  title: "",
  phone: "",
  customer_email: "",
  documento: "",
  contato_preferido: "WhatsApp",
  status: "novo",
  description: "",
};

export function ClientsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, removeRecord } = useModuleRecords(
    "clients",
    session.user.id,
  );
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!q) return true;
      const haystack = [
        row.title,
        row.customer_name,
        row.phone,
        row.customer_email,
        detail(row, "documento"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setForm({
      title: row.title || row.customer_name || "",
      phone: row.phone ?? "",
      customer_email: row.customer_email ?? "",
      documento: String(detail(row, "documento") ?? ""),
      contato_preferido: String(detail(row, "contato_preferido") ?? "WhatsApp"),
      status: row.status || "novo",
      description: row.description ?? "",
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await saveRecord(editing, {
        title: form.title.trim(),
        customer_name: form.title.trim(),
        phone: form.phone.trim() || null,
        customer_email: form.customer_email.trim() || null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          documento: form.documento.trim(),
          contato_preferido: form.contato_preferido,
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">CADASTRO DE CLIENTES</p>
          <h1>Clientes</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Novo cliente
          </button>
        </div>
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por nome, telefone, e-mail ou CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Users size={24} />
          <strong>Nenhum cliente encontrado</strong>
          <p>Cadastre um novo cliente ou altere o termo de busca.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>E-mail</th>
                <th>CPF/CNPJ</th>
                <th>Cadastro</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.title || row.customer_name || "—"}</div>
                    {Boolean(detail(row, "contato_preferido")) && (
                      <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                        Pref.: {String(detail(row, "contato_preferido"))}
                      </div>
                    )}
                  </td>
                  <td>{asText(row.phone)}</td>
                  <td>{asText(row.customer_email)}</td>
                  <td>{asText(detail(row, "documento"))}</td>
                  <td>{dateText(row.created_at)}</td>
                  <td>
                    <AdminStatusBadge status={row.status} />
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button
                        type="button"
                        className="admin-icon-btn"
                        title="Editar"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="admin-icon-btn danger"
                        title="Remover"
                        onClick={() => void removeRecord(row)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar cliente" : "Novo cliente"}</h2>
                <p>Preencha os dados cadastrais e de contato do cliente.</p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => setModalOpen(false)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Nome completo</label>
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex: João da Silva"
                  />
                </div>
                <div className="admin-field">
                  <label>Telefone</label>
                  <input
                    className="admin-input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(11) 99999-9999"
                  />
                </div>
                <div className="admin-field">
                  <label>E-mail</label>
                  <input
                    type="email"
                    className="admin-input"
                    value={form.customer_email}
                    onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                    placeholder="cliente@exemplo.com"
                  />
                </div>
                <div className="admin-field">
                  <label>CPF/CNPJ</label>
                  <input
                    className="admin-input"
                    value={form.documento}
                    onChange={(e) => setForm({ ...form, documento: e.target.value })}
                    placeholder="000.000.000-00"
                  />
                </div>
                <div className="admin-field">
                  <label>Contato preferido</label>
                  <select
                    className="admin-select"
                    value={form.contato_preferido}
                    onChange={(e) => setForm({ ...form, contato_preferido: e.target.value })}
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Telefone">Telefone</option>
                    <option value="E-mail">E-mail</option>
                  </select>
                </div>
                <div className="admin-field wide">
                  <label>Observações</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Notas internas, preferências ou histórico..."
                  />
                </div>
              </div>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
