"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Camera,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Pencil,
  Search,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";
import {
  selectRows,
  updatePassword,
  updateRow,
  type AuditEntry,
  type PanelMember,
  type Session,
} from "../../../lib/supabase";
import { SkeletonTable } from "../Skeletons";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, modalBackdropProps } from "../utils";

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  advisor: "Consultor",
  technician: "Técnico",
  finance: "Financeiro",
};

const roleOptions = ["owner", "manager", "advisor", "technician", "finance"] as const;

type AccountTab = "perfil" | "seguranca" | "equipe" | "auditoria";

export function AccountView({
  session,
  member,
  onMemberUpdate,
}: {
  session: Session;
  member: PanelMember;
  onMemberUpdate?: (next: PanelMember) => void;
}) {
  const canManageTeam = member.role === "owner" || member.role === "manager";
  const [activeTab, setActiveTab] = useState<AccountTab>("perfil");

  // Perfil
  const [fullName, setFullName] = useState(member.full_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; type: "success" | "error" } | null>(
    null,
  );

  // Senha
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // 2FA WhatsApp
  const [twoFactorPhone, setTwoFactorPhone] = useState("");
  const [savedTwoFactorPhone, setSavedTwoFactorPhone] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorStep, setTwoFactorStep] = useState<"idle" | "awaiting_code">("idle");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorSaving, setTwoFactorSaving] = useState(false);
  const [twoFactorMsg, setTwoFactorMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Equipe & Auditoria
  const [members, setMembers] = useState<PanelMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [teamLoading, setTeamLoading] = useState(canManageTeam);
  const [teamError, setTeamError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState("");

  // Modal editar membro
  const [editingMember, setEditingMember] = useState<PanelMember | null>(null);
  const [editMemberName, setEditMemberName] = useState("");
  const [editMemberRole, setEditMemberRole] = useState("advisor");
  const [savingMember, setSavingMember] = useState(false);

  useEffect(() => {
    setFullName(member.full_name ?? "");
  }, [member.full_name]);

  useEffect(() => {
    const emailKey = (session.user.email ?? "").trim().toLowerCase();
    if (!emailKey) return;
    try {
      setAvatarUrl(localStorage.getItem(`admin-avatar:${emailKey}`) ?? "");
    } catch {
      // ignore storage errors
    }
  }, [session.user.email]);

  function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileMsg({ text: "Selecione um arquivo de imagem válido.", type: "error" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
        const emailKey = (session.user.email ?? "").trim().toLowerCase();
        try {
          if (emailKey) localStorage.setItem(`admin-avatar:${emailKey}`, dataUrl);
          window.dispatchEvent(new Event("admin-avatar-change"));
        } catch {
          // ignore storage errors
        }
        setAvatarUrl(dataUrl);
        setProfileMsg({ text: "Foto de perfil atualizada.", type: "success" });
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveAvatar() {
    const emailKey = (session.user.email ?? "").trim().toLowerCase();
    try {
      if (emailKey) localStorage.removeItem(`admin-avatar:${emailKey}`);
      window.dispatchEvent(new Event("admin-avatar-change"));
    } catch {
      // ignore storage errors
    }
    setAvatarUrl("");
  }

  useEffect(() => {
    void fetch("/api/admin/account/2fa", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { phone?: string; two_factor_enabled?: boolean } | null) => {
        if (!d) return;
        setTwoFactorPhone(d.phone ?? "");
        setSavedTwoFactorPhone(d.phone ?? "");
        setTwoFactorEnabled(Boolean(d.two_factor_enabled));
      })
      .catch(() => {});
  }, [session.access_token]);

  async function handleSend2FACode() {
    setTwoFactorSaving(true);
    setTwoFactorMsg(null);
    try {
      const res = await fetch("/api/admin/account/2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "send_code",
          phone: twoFactorPhone,
        }),
      });
      const json = (await res.json()) as { phone?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Não foi possível enviar o código.");
      if (json.phone) setTwoFactorPhone(json.phone);
      setTwoFactorStep("awaiting_code");
      setTwoFactorCode("");
      setTwoFactorMsg({
        text: "Código de 6 dígitos enviado para seu WhatsApp. Digite abaixo para confirmar.",
        type: "success",
      });
    } catch (reason) {
      setTwoFactorMsg({
        text: reason instanceof Error ? reason.message : "Erro ao enviar código 2FA.",
        type: "error",
      });
    } finally {
      setTwoFactorSaving(false);
    }
  }

  async function handleVerifyEnable2FA(e: FormEvent) {
    e.preventDefault();
    setTwoFactorSaving(true);
    setTwoFactorMsg(null);
    try {
      const res = await fetch("/api/admin/account/2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "verify_enable",
          phone: twoFactorPhone,
          code: twoFactorCode,
        }),
      });
      const json = (await res.json()) as {
        phone?: string;
        two_factor_enabled?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Código inválido.");
      const nextPhone = json.phone ?? twoFactorPhone;
      setTwoFactorPhone(nextPhone);
      setSavedTwoFactorPhone(nextPhone);
      setTwoFactorEnabled(true);
      setTwoFactorStep("idle");
      setTwoFactorCode("");
      setTwoFactorMsg({
        text: "2FA via WhatsApp ativado com sucesso.",
        type: "success",
      });
    } catch (reason) {
      setTwoFactorMsg({
        text: reason instanceof Error ? reason.message : "Erro ao validar código.",
        type: "error",
      });
    } finally {
      setTwoFactorSaving(false);
    }
  }

  async function handleDisable2FA() {
    setTwoFactorSaving(true);
    setTwoFactorMsg(null);
    try {
      const res = await fetch("/api/admin/account/2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "disable",
          phone: twoFactorPhone,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Não foi possível desativar o 2FA.");
      setTwoFactorEnabled(false);
      setTwoFactorStep("idle");
      setTwoFactorCode("");
      setTwoFactorMsg({
        text: "2FA desativado.",
        type: "success",
      });
    } catch (reason) {
      setTwoFactorMsg({
        text: reason instanceof Error ? reason.message : "Erro ao desativar 2FA.",
        type: "error",
      });
    } finally {
      setTwoFactorSaving(false);
    }
  }

  useEffect(() => {
    if (!canManageTeam) return;
    setTeamLoading(true);
    setTeamError("");
    void Promise.all([
      selectRows<PanelMember>("panel_members", { order: "created_at.asc", limit: "100" }),
      selectRows<AuditEntry>("audit_logs", { order: "created_at.desc", limit: "50" }).catch(() => []),
    ])
      .then(([teamData, auditData]) => {
        setMembers(teamData);
        setAuditLogs(auditData);
      })
      .catch((reason: Error) => setTeamError(reason.message))
      .finally(() => setTeamLoading(false));
  }, [canManageTeam]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((entry) =>
      [entry.actor_email, entry.action, entry.module, entry.record_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [auditLogs, auditSearch]);

  const initials = (fullName.trim() || session.user.email || "B")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const updated = await updateRow<PanelMember>(
        "panel_members",
        session.user.id,
        { full_name: fullName.trim() || null },
        "user_id",
      );
      const nextMember = updated[0] ?? { ...member, full_name: fullName.trim() || null };
      onMemberUpdate?.(nextMember);
      setMembers((curr) =>
        curr.map((m) => (m.user_id === session.user.id ? nextMember : m)),
      );
      setProfileMsg({ text: "Perfil atualizado com sucesso.", type: "success" });
    } catch (reason) {
      setProfileMsg({
        text: reason instanceof Error ? reason.message : "Erro ao atualizar perfil.",
        type: "error",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPwdMsg(null);
    if (newPassword.length < 12) {
      setPwdMsg({ text: "A nova senha deve ter pelo menos 12 caracteres.", type: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ text: "A confirmação da senha não confere.", type: "error" });
      return;
    }
    setPwdLoading(true);
    try {
      await updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setPwdMsg({ text: "Senha atualizada com sucesso.", type: "success" });
    } catch (reason) {
      setPwdMsg({
        text: reason instanceof Error ? reason.message : "Não foi possível atualizar a senha.",
        type: "error",
      });
    } finally {
      setPwdLoading(false);
    }
  }

  async function handleRoleChange(targetMember: PanelMember, nextRole: string) {
    setBusyUserId(targetMember.user_id);
    setTeamError("");
    try {
      const updated = await updateRow<PanelMember>(
        "panel_members",
        targetMember.user_id,
        { role: nextRole },
        "user_id",
      );
      if (updated[0]) {
        setMembers((curr) =>
          curr.map((item) => (item.user_id === targetMember.user_id ? updated[0] : item)),
        );
      }
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao atualizar perfil.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleToggleActive(targetMember: PanelMember) {
    setBusyUserId(targetMember.user_id);
    setTeamError("");
    try {
      const updated = await updateRow<PanelMember>(
        "panel_members",
        targetMember.user_id,
        { active: !targetMember.active },
        "user_id",
      );
      if (updated[0]) {
        setMembers((curr) =>
          curr.map((item) => (item.user_id === targetMember.user_id ? updated[0] : item)),
        );
      }
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao atualizar acesso.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleSaveMemberModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMember) return;
    setSavingMember(true);
    setTeamError("");
    try {
      const updated = await updateRow<PanelMember>(
        "panel_members",
        editingMember.user_id,
        {
          full_name: editMemberName.trim() || null,
          role: editMemberRole,
        },
        "user_id",
      );
      if (updated[0]) {
        setMembers((curr) =>
          curr.map((item) => (item.user_id === editingMember.user_id ? updated[0] : item)),
        );
        if (editingMember.user_id === session.user.id) {
          onMemberUpdate?.(updated[0]);
        }
      }
      setEditingMember(null);
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao salvar membro.");
    } finally {
      setSavingMember(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">SISTEMA · CONTA & EQUIPE</p>
          <h1>Minha conta e equipe</h1>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${activeTab === "perfil" ? "active" : ""}`}
            onClick={() => setActiveTab("perfil")}
          >
            <User size={13} /> Perfil
          </button>
          <button
            type="button"
            className={`admin-pill ${activeTab === "seguranca" ? "active" : ""}`}
            onClick={() => setActiveTab("seguranca")}
          >
            <KeyRound size={13} /> Segurança e senha
          </button>
          {canManageTeam && (
            <button
              type="button"
              className={`admin-pill ${activeTab === "equipe" ? "active" : ""}`}
              onClick={() => setActiveTab("equipe")}
            >
              <Users size={13} /> Equipe ({members.length})
            </button>
          )}
          {canManageTeam && (
            <button
              type="button"
              className={`admin-pill ${activeTab === "auditoria" ? "active" : ""}`}
              onClick={() => setActiveTab("auditoria")}
            >
              <History size={13} /> Auditoria ({auditLogs.length})
            </button>
          )}
        </div>
      </div>

      {activeTab === "perfil" && (
        <div className="admin-bento">
          <section className="admin-panel" style={{ alignSelf: "start", height: "auto" }}>
            <div className="admin-panel-head">
              <h2>Dados pessoais</h2>
              <ShieldCheck size={16} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                title="Alterar foto de perfil"
                style={{
                  position: "relative",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  borderRadius: "50%",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <div className="admin-avatar" style={{ width: 56, height: 56, minWidth: 56, fontSize: 19 }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={fullName.trim() || "Foto de perfil"} />
                  ) : (
                    initials
                  )}
                </div>
                <span
                  style={{
                    position: "absolute",
                    right: -2,
                    bottom: -2,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--admin-card)",
                    border: "1px solid var(--admin-line)",
                    color: "var(--admin-ink)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Camera size={11} />
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleAvatarUpload}
              />
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ fontSize: 15 }}>
                  {fullName.trim() || session.user.email}
                </strong>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <AdminStatusBadge
                    status="ativo"
                    label={roleLabels[member.role] ?? member.role}
                  />
                  <button
                    type="button"
                    className="admin-link"
                    style={{ fontSize: 12 }}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    Alterar foto
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      className="admin-link-muted"
                      style={{ fontSize: 12 }}
                      onClick={handleRemoveAvatar}
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleSaveProfile(e)}
              style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}
            >
              <label className="admin-field">
                Nome completo
                <input
                  className="admin-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome na oficina"
                />
              </label>

              <label className="admin-field">
                E-mail de acesso
                <input className="admin-input" value={session.user.email ?? ""} readOnly />
              </label>

              {profileMsg && (
                <p
                  className={
                    profileMsg.type === "success" ? "admin-form-success" : "admin-form-error"
                  }
                >
                  {profileMsg.text}
                </p>
              )}

              <div className="admin-modal-actions" style={{ marginTop: "auto", paddingTop: 14 }}>
                <button type="submit" className="admin-primary" disabled={savingProfile}>
                  {savingProfile ? "Salvando…" : "Salvar perfil"}
                </button>
              </div>
            </form>
          </section>

          <section className="admin-panel" style={{ alignSelf: "start", height: "auto" }}>
            <div className="admin-panel-head">
              <h2>Permissões de acesso</h2>
              <User size={16} />
            </div>
            <div style={{ display: "grid", gap: 16, fontSize: 13 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ color: "var(--admin-muted)", fontSize: 11.5 }}>Cargo atual</div>
                  <strong>{roleLabels[member.role] ?? member.role}</strong>
                </div>
                <div>
                  <div style={{ color: "var(--admin-muted)", fontSize: 11.5 }}>Status da conta</div>
                  <div style={{ marginTop: 2 }}>
                    <AdminStatusBadge
                      status={member.active ? "ativo" : "cancelado"}
                      label={member.active ? "Ativa" : "Suspensa"}
                    />
                  </div>
                </div>
              </div>
              <div>
                <div style={{ color: "var(--admin-muted)", fontSize: 11.5 }}>Membro desde</div>
                <strong>{dateText(member.created_at)}</strong>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === "seguranca" && (
        <div className="admin-bento">
          <section className="admin-panel" style={{ alignSelf: "start", height: "auto" }}>
            <div className="admin-panel-head">
              <h2>Alterar senha de acesso</h2>
              <KeyRound size={16} />
            </div>

            <form
              onSubmit={(e) => void handlePasswordSubmit(e)}
              style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}
            >
              <label className="admin-field">
                Nova senha
                <div className="admin-password-wrap">
                  <input
                    className="admin-input"
                    type={showNewPass ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo de 12 caracteres"
                    minLength={12}
                    required
                  />
                  <button
                    type="button"
                    className="admin-password-toggle"
                    onClick={() => setShowNewPass((v) => !v)}
                    aria-label="Mostrar ou ocultar senha"
                  >
                    {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </label>

              <label className="admin-field">
                Confirmar nova senha
                <div className="admin-password-wrap">
                  <input
                    className="admin-input"
                    type={showConfirmPass ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    minLength={12}
                    required
                  />
                  <button
                    type="button"
                    className="admin-password-toggle"
                    onClick={() => setShowConfirmPass((v) => !v)}
                    aria-label="Mostrar ou ocultar confirmação"
                  >
                    {showConfirmPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </label>

              {pwdMsg && (
                <p className={pwdMsg.type === "success" ? "admin-form-success" : "admin-form-error"}>
                  {pwdMsg.text}
                </p>
              )}

              <div className="admin-modal-actions" style={{ marginTop: "auto", paddingTop: 14 }}>
                <button type="submit" className="admin-primary" disabled={pwdLoading}>
                  {pwdLoading ? "Salvando…" : "Atualizar senha"}
                </button>
              </div>
            </form>
          </section>

          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <section className="admin-panel" style={{ alignSelf: "start", height: "auto" }}>
              <div className="admin-panel-head">
                <h2>Segurança da sessão</h2>
                <ShieldCheck size={16} />
              </div>
              <div style={{ display: "grid", gap: 14, fontSize: 13 }}>
                <div>
                  <div style={{ color: "var(--admin-muted)", fontSize: 11.5 }}>Conta autenticada</div>
                  <strong>{session.user.email}</strong>
                </div>
                <div>
                  <div style={{ color: "var(--admin-muted)", fontSize: 11.5 }}>Sessão</div>
                  <AdminStatusBadge status="ativo" label="Autenticada via API" />
                </div>
              </div>
            </section>

            <section className="admin-panel" style={{ alignSelf: "start", height: "auto" }}>
            <div className="admin-panel-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2>Verificação em duas etapas (2FA via WhatsApp)</h2>
                <AdminStatusBadge
                  status={twoFactorEnabled ? "ativo" : "cancelado"}
                  label={twoFactorEnabled ? "Ativo" : "Desativado"}
                />
              </div>
              <ShieldCheck size={16} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (twoFactorStep === "awaiting_code") {
                  void handleVerifyEnable2FA(e);
                } else {
                  void handleSend2FACode();
                }
              }}
              style={{ display: "grid", gap: 14 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div className="admin-field" style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <label>WhatsApp para códigos 2FA</label>
                  <input
                    className="admin-input"
                    value={twoFactorPhone}
                    onChange={(e) => {
                      setTwoFactorPhone(e.target.value);
                      if (twoFactorStep === "awaiting_code") setTwoFactorStep("idle");
                    }}
                    placeholder="5511999999999"
                  />
                </div>

                {twoFactorStep === "awaiting_code" && (
                  <div className="admin-field" style={{ flex: "0 1 180px", minWidth: 140 }}>
                    <label>Código recebido</label>
                    <input
                      className="admin-input"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      autoFocus
                    />
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {twoFactorStep === "awaiting_code" ? (
                    <>
                      <button
                        type="submit"
                        className="admin-primary"
                        disabled={twoFactorSaving || twoFactorCode.length !== 6}
                      >
                        {twoFactorSaving ? "Validando…" : "Confirmar e ativar"}
                      </button>
                      <button
                        type="button"
                        className="admin-secondary"
                        disabled={twoFactorSaving}
                        onClick={() => void handleSend2FACode()}
                      >
                        Reenviar
                      </button>
                    </>
                  ) : !twoFactorEnabled || twoFactorPhone !== savedTwoFactorPhone ? (
                    <button
                      type="submit"
                      className="admin-primary"
                      disabled={twoFactorSaving}
                    >
                      {twoFactorSaving
                        ? "Enviando…"
                        : twoFactorEnabled
                          ? "Verificar novo número"
                          : "Enviar código para ativar"}
                    </button>
                  ) : null}

                  {twoFactorEnabled && (
                    <button
                      type="button"
                      className="admin-secondary"
                      disabled={twoFactorSaving}
                      onClick={() => void handleDisable2FA()}
                    >
                      Desativar 2FA
                    </button>
                  )}
                </div>
              </div>

              {twoFactorMsg && (
                <p className={twoFactorMsg.type === "success" ? "admin-form-success" : "admin-form-error"}>
                  {twoFactorMsg.text}
                </p>
              )}
            </form>
            </section>
          </div>
        </div>
      )}

      {activeTab === "equipe" && canManageTeam && (
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>Membros da equipe ({members.length})</h2>
            <Users size={16} />
          </div>

          {teamError && (
            <p className="admin-form-error" style={{ marginBottom: 14 }}>
              {teamError}
            </p>
          )}

          {teamLoading ? (
            <SkeletonTable rows={4} />
          ) : members.length === 0 ? (
            <div className="admin-empty">
              <strong>Nenhum membro encontrado</strong>
              <p>Os usuários cadastrados em panel_members aparecerão aqui.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Membro</th>
                    <th>Perfil</th>
                    <th>Status</th>
                    <th>Cadastro</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const isSelf = m.user_id === session.user.id;
                    return (
                      <tr key={m.user_id}>
                        <td>
                          <strong>{m.full_name || m.email}</strong>
                          <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                            {m.email}
                          </div>
                        </td>
                        <td>
                          <select
                            className="admin-select"
                            value={m.role}
                            disabled={busyUserId === m.user_id || member.role !== "owner"}
                            onChange={(e) => void handleRoleChange(m, e.target.value)}
                            style={{ width: "auto", minWidth: 140 }}
                          >
                            {roleOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {roleLabels[opt] ?? opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <AdminStatusBadge
                            status={m.active ? "ativo" : "cancelado"}
                            label={m.active ? "Ativo" : "Suspenso"}
                          />
                        </td>
                        <td>{dateText(m.created_at)}</td>
                        <td>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                            <button
                              type="button"
                              className="admin-icon-btn"
                              title="Editar membro"
                              onClick={() => {
                                setEditingMember(m);
                                setEditMemberName(m.full_name ?? "");
                                setEditMemberRole(m.role);
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className={m.active ? "admin-ghost-danger" : "admin-secondary"}
                              disabled={busyUserId === m.user_id || isSelf}
                              onClick={() => void handleToggleActive(m)}
                            >
                              {m.active ? "Suspender" : "Reativar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "auditoria" && canManageTeam && (
        <section className="admin-panel">
          <div className="admin-panel-head">
            <h2>Auditoria recente ({filteredAudit.length})</h2>
            <div className="admin-search-wrap" style={{ width: 260 }}>
              <Search size={14} />
              <input
                className="admin-search"
                placeholder="Filtrar auditoria..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                style={{ minHeight: 34 }}
              />
            </div>
          </div>

          {teamLoading ? (
            <SkeletonTable rows={5} />
          ) : filteredAudit.length === 0 ? (
            <div className="admin-empty">
              <strong>Sem registros de auditoria</strong>
              <p>As ações realizadas no painel serão listadas aqui.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Módulo</th>
                    <th>Registro</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((entry) => (
                    <tr key={entry.id}>
                      <td>{asText(entry.actor_email)}</td>
                      <td>
                        <AdminStatusBadge status="novo" label={asText(entry.action)} />
                      </td>
                      <td>{asText(entry.module)}</td>
                      <td>{asText(entry.record_title)}</td>
                      <td>
                        {dateText(entry.created_at, { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editingMember && (
        <div
          className="admin-modal-backdrop"
          {...modalBackdropProps(() => setEditingMember(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Editar membro</h2>
                <p>{editingMember.email}</p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => setEditingMember(null)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveMemberModal(e)}>
              <div className="admin-form-grid">
                <label className="admin-field wide">
                  Nome completo
                  <input
                    className="admin-input"
                    value={editMemberName}
                    onChange={(e) => setEditMemberName(e.target.value)}
                    placeholder="Nome do colaborador"
                  />
                </label>
                <label className="admin-field wide">
                  Perfil de acesso
                  <select
                    className="admin-select"
                    value={editMemberRole}
                    disabled={member.role !== "owner"}
                    onChange={(e) => setEditMemberRole(e.target.value)}
                  >
                    {roleOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {roleLabels[opt] ?? opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setEditingMember(null)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={savingMember}>
                  {savingMember ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
