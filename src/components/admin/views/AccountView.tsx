"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Camera,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Pencil,
  Plus,
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
import { useProfilePhoto } from "../ProfilePhoto";
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
  const { avatarUrl, savePhoto } = useProfilePhoto();
  const [savingPhoto, setSavingPhoto] = useState(false);
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
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorStep, setTwoFactorStep] = useState<"idle" | "awaiting_code" | "awaiting_disable_code">("idle");
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
  const [createMemberOpen, setCreateMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("advisor");

  useEffect(() => {
    setFullName(member.full_name ?? "");
  }, [member.full_name]);

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || savingPhoto) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setProfileMsg({ text: "Selecione uma imagem de até 10 MB.", type: "error" });
      return;
    }
    setSavingPhoto(true);
    setProfileMsg(null);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Imagem inválida.");
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
      await savePhoto(canvas.toDataURL("image/jpeg", 0.86));
      setProfileMsg({ text: "Foto de perfil salva.", type: "success" });
    } catch {
      setProfileMsg({ text: "Não foi possível salvar a foto. Tente novamente.", type: "error" });
    } finally {
      URL.revokeObjectURL(url);
      setSavingPhoto(false);
    }
  }

  async function handleRemoveAvatar() {
    if (savingPhoto) return;
    setSavingPhoto(true);
    setProfileMsg(null);
    try {
      await savePhoto(null);
      setProfileMsg({ text: "Foto de perfil removida.", type: "success" });
    } catch {
      setProfileMsg({ text: "Não foi possível remover a foto. Tente novamente.", type: "error" });
    } finally {
      setSavingPhoto(false);
    }
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
          action: twoFactorStep === "awaiting_disable_code" ? "send_disable_code" : "send_code",
          phone: twoFactorPhone,
          password: twoFactorPassword,
        }),
      });
      const json = (await res.json()) as { phone?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Não foi possível enviar o código.");
      if (json.phone) setTwoFactorPhone(json.phone);
      setTwoFactorStep(twoFactorStep === "awaiting_disable_code" ? "awaiting_disable_code" : "awaiting_code");
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
          action: twoFactorStep === "awaiting_disable_code" ? "disable" : "verify_enable",
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
      setTwoFactorEnabled(json.two_factor_enabled ?? true);
      setTwoFactorStep("idle");
      setTwoFactorCode("");
      setTwoFactorPassword("");
      setTwoFactorMsg({
        text: json.two_factor_enabled === false ? "2FA desativado." : "2FA via WhatsApp ativado com sucesso.",
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
          action: "send_disable_code",
          phone: twoFactorPhone,
          password: twoFactorPassword,
          code: twoFactorCode,
        }),
      });
      const json = (await res.json()) as { error?: string; phone?: string };
      if (!res.ok) throw new Error(json.error || "Não foi possível atualizar o 2FA.");
      setTwoFactorStep("awaiting_disable_code");
      setTwoFactorCode("");
      setTwoFactorMsg({ text: "Enviamos um código para o WhatsApp cadastrado. Digite-o para desativar o 2FA.", type: "success" });
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

  async function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingMember(true);
    setTeamError("");
    try {
      const response = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          full_name: newMemberName,
          email: newMemberEmail,
          password: newMemberPassword,
          role: newMemberRole,
        }),
      });
      const result = await response.json() as { member?: PanelMember; error?: string };
      if (!response.ok || !result.member) throw new Error(result.error || "Não foi possível criar a conta.");
      setMembers((current) => [...current, result.member!]);
      setNewMemberName("");
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberRole("advisor");
      setCreateMemberOpen(false);
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao criar conta.");
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
                disabled={savingPhoto}
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
                    disabled={savingPhoto}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {savingPhoto ? "Salvando…" : "Alterar foto"}
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      className="admin-link-muted"
                      style={{ fontSize: 12 }}
                      disabled={savingPhoto}
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
                if (twoFactorStep !== "idle") {
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
                      if (twoFactorStep !== "idle") setTwoFactorStep("idle");
                    }}
                    placeholder="5511999999999"
                  />
                </div>

                <div className="admin-field" style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <label>Senha atual para confirmar alterações</label>
                  <input
                    className="admin-input"
                    type="password"
                    autoComplete="current-password"
                    value={twoFactorPassword}
                    onChange={(e) => setTwoFactorPassword(e.target.value)}
                    placeholder="Digite sua senha atual"
                    required={twoFactorStep === "idle"}
                  />
                </div>

                {twoFactorStep !== "idle" && (
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
                  {twoFactorStep !== "idle" ? (
                    <>
                      <button
                        type="submit"
                        className="admin-primary"
                        disabled={twoFactorSaving || twoFactorCode.length !== 6}
                      >
                        {twoFactorSaving ? "Validando…" : twoFactorStep === "awaiting_disable_code" ? "Confirmar desativação" : "Confirmar e ativar"}
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

                  {twoFactorEnabled && twoFactorStep !== "awaiting_disable_code" && (
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
            {member.role === "owner" ? (
              <button type="button" className="admin-primary" onClick={() => setCreateMemberOpen(true)}>
                <Plus size={15} /> Criar conta
              </button>
            ) : <Users size={16} />}
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

      {createMemberOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setCreateMemberOpen(false))}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Criar conta da equipe</h2>
                <p>A conta poderá entrar no painel assim que for criada.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setCreateMemberOpen(false)} aria-label="Fechar">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(event) => void handleCreateMember(event)}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Nome completo</label>
                  <input className="admin-input" required maxLength={120} value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} />
                </div>
                <div className="admin-field wide">
                  <label>E-mail</label>
                  <input className="admin-input" type="email" required maxLength={254} value={newMemberEmail} onChange={(event) => setNewMemberEmail(event.target.value)} />
                </div>
                <div className="admin-field wide">
                  <label>Senha inicial (mínimo 12 caracteres)</label>
                  <input className="admin-input" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newMemberPassword} onChange={(event) => setNewMemberPassword(event.target.value)} />
                </div>
                <div className="admin-field wide">
                  <label>Cargo</label>
                  <select className="admin-select" value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value)}>
                    {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </div>
              </div>
              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setCreateMemberOpen(false)}>Cancelar</button>
                <button type="submit" className="admin-primary" disabled={savingMember}>{savingMember ? "Criando…" : "Criar conta"}</button>
              </div>
            </form>
          </div>
        </div>
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
