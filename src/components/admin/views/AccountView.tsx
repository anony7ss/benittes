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
import { Checkbox } from "@/components/ui/checkbox";
import { hasModulePermission, PANEL_PERMISSION_MODULES, type PanelPermissionModule, type PanelPermissions } from "../../../admin/permissions";
import {
  selectRows,
  updatePassword,
  updateRow,
  type AuditEntry,
  type PanelMember,
  type Session,
} from "../../../lib/supabase";
import { useProfilePhoto } from "../ProfilePhoto";
import { usePagination } from "../Pagination";
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

type PanelRole = {
  role_key: string;
  name: string;
  permissions: PanelPermissions;
  is_system: boolean;
  created_at: string;
};

type AccountTab = "perfil" | "seguranca" | "equipe" | "cargos" | "auditoria";

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
  const isOwner = member.role === "owner";
  const canAccessAudit = canManageTeam || hasModulePermission(member.permissions, "audit", "read");
  const [activeTab, setActiveTab] = useState<AccountTab>("perfil");

  // Perfil
  const [fullName, setFullName] = useState(member.full_name ?? "");
  const { avatarUrl, previewPhoto, restorePhotoPreview, savePhoto } = useProfilePhoto();
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
  const [teamLoading, setTeamLoading] = useState(canManageTeam || canAccessAudit);
  const [teamError, setTeamError] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [roles, setRoles] = useState<PanelRole[]>([]);
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<PanelRole | null>(null);
  const [roleName, setRoleName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<PanelPermissions>({});
  const [savingRole, setSavingRole] = useState(false);

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
    previewPhoto(url);
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
      await savePhoto(canvas.toDataURL("image/jpeg", 0.86), url);
      setProfileMsg({ text: "Foto de perfil salva.", type: "success" });
    } catch {
      restorePhotoPreview();
      setProfileMsg({ text: "Não foi possível salvar a foto. Tente novamente.", type: "error" });
    } finally {
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
      credentials: "same-origin",
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
  }, []);

  async function handleSend2FACode() {
    setTwoFactorSaving(true);
    setTwoFactorMsg(null);
    try {
      const res = await fetch("/api/admin/account/2fa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
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
        },
        credentials: "same-origin",
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
        },
        credentials: "same-origin",
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
    if (!canManageTeam && !canAccessAudit) return;
    setTeamLoading(true);
    setTeamError("");
    void Promise.all([
      canManageTeam ? selectRows<PanelMember>("panel_members", { order: "created_at.asc", limit: "100" }) : Promise.resolve([] as PanelMember[]),
      canAccessAudit ? selectRows<AuditEntry>("audit_logs", { order: "created_at.desc", limit: "50" }).catch(() => []) : Promise.resolve([] as AuditEntry[]),
      isOwner
        ? fetch("/api/admin/roles", { credentials: "same-origin", cache: "no-store" })
            .then(async (response) => {
              const result = await response.json() as { roles?: PanelRole[]; error?: string };
              if (!response.ok) throw new Error(result.error || "Não foi possível carregar os cargos.");
              return result.roles ?? [];
            })
            .catch((reason: Error) => {
              setTeamError(reason.message);
              return [] as PanelRole[];
            })
        : Promise.resolve([] as PanelRole[]),
    ])
      .then(([teamData, auditData, roleData]) => {
        setMembers(teamData);
        setAuditLogs(auditData);
        setRoles(roleData);
      })
      .catch((reason: Error) => setTeamError(reason.message))
      .finally(() => setTeamLoading(false));
  }, [canManageTeam, canAccessAudit, isOwner]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((entry) =>
      [entry.actor_email, entry.action, entry.module, entry.record_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [auditLogs, auditSearch]);
  const { pageItems: auditPage, controls: auditPagination } = usePagination(filteredAudit);
  const availableRoles = roles.length
    ? roles
    : Object.entries(roleLabels).map(([role_key, name]) => ({ role_key, name, permissions: {}, is_system: true, created_at: "" }));
  const roleNameFor = (roleKey: string) => availableRoles.find((role) => role.role_key === roleKey)?.name ?? roleLabels[roleKey] ?? roleKey;

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
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
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

  function openRoleEditor(role?: PanelRole) {
    setEditingRole(role ?? null);
    setRoleName(role?.name ?? "");
    const next: PanelPermissions = {};
    const wildcard = role?.permissions?.["*"];
    for (const { key } of PANEL_PERMISSION_MODULES) {
      const existing = role?.permissions?.[key];
      const write = existing?.write === true || wildcard?.write === true;
      next[key] = {
        read: existing?.read === true || existing?.write === true || wildcard?.read === true || wildcard?.write === true,
        write,
      };
    }
    setRolePermissions(next);
    setRoleEditorOpen(true);
  }

  function setRolePermission(module: PanelPermissionModule, access: "read" | "write", enabled: boolean) {
    setRolePermissions((current) => {
      const existing = current[module] ?? { read: false, write: false };
      if (access === "write") return { ...current, [module]: { read: enabled || existing.read, write: enabled } };
      return { ...current, [module]: { read: enabled, write: enabled && existing.write } };
    });
  }

  function setAllRolePermissions(preset: "all" | "read-only" | "none") {
    const next: PanelPermissions = {};
    for (const { key } of PANEL_PERMISSION_MODULES) {
      next[key] = preset === "all"
        ? { read: true, write: true }
        : preset === "read-only"
          ? { read: true, write: false }
          : { read: false, write: false };
    }
    setRolePermissions(next);
  }

  function setRolePermissionColumn(access: "read" | "write", enabled: boolean) {
    setRolePermissions((current) => {
      const next: PanelPermissions = {};
      for (const { key } of PANEL_PERMISSION_MODULES) {
        const existing = current[key] ?? { read: false, write: false };
        next[key] = access === "read"
          ? { read: enabled, write: enabled && existing.write }
          : { read: enabled || existing.read, write: enabled };
      }
      return next;
    });
  }

  const readPermissionCount = PANEL_PERMISSION_MODULES.filter(({ key }) => rolePermissions[key]?.read || rolePermissions[key]?.write).length;
  const writePermissionCount = PANEL_PERMISSION_MODULES.filter(({ key }) => rolePermissions[key]?.write).length;
  const readColumnChecked: boolean | "indeterminate" = readPermissionCount === 0
    ? false
    : readPermissionCount === PANEL_PERMISSION_MODULES.length ? true : "indeterminate";
  const writeColumnChecked: boolean | "indeterminate" = writePermissionCount === 0
    ? false
    : writePermissionCount === PANEL_PERMISSION_MODULES.length ? true : "indeterminate";

  async function handleSaveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRole(true);
    setTeamError("");
    try {
      const response = await fetch("/api/admin/roles", {
        method: editingRole ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role_key: editingRole?.role_key, name: roleName, permissions: rolePermissions }),
      });
      const result = await response.json() as { role?: PanelRole; error?: string };
      if (!response.ok || !result.role) throw new Error(result.error || "Não foi possível salvar o cargo.");
      setRoles((current) => editingRole
        ? current.map((role) => role.role_key === result.role!.role_key ? result.role! : role)
        : [...current, result.role!].sort((a, b) => Number(b.is_system) - Number(a.is_system) || a.name.localeCompare(b.name, "pt-BR")));
      setRoleEditorOpen(false);
      setEditingRole(null);
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao salvar cargo.");
    } finally {
      setSavingRole(false);
    }
  }

  async function handleDeleteRole(role: PanelRole) {
    if (role.is_system || !window.confirm(`Excluir o cargo "${role.name}"?`)) return;
    setTeamError("");
    try {
      const response = await fetch(`/api/admin/roles?role_key=${encodeURIComponent(role.role_key)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível excluir o cargo.");
      setRoles((current) => current.filter((item) => item.role_key !== role.role_key));
    } catch (reason) {
      setTeamError(reason instanceof Error ? reason.message : "Erro ao excluir cargo.");
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
          {isOwner && (
            <button
              type="button"
              className={`admin-pill ${activeTab === "cargos" ? "active" : ""}`}
              onClick={() => setActiveTab("cargos")}
            >
              <ShieldCheck size={13} /> Cargos
            </button>
          )}
          {canAccessAudit && (
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
                onChange={handleAvatarUpload} id="admin-views-accountview-669"
              />
              <div style={{ display: "grid", gap: 6 }}>
                <strong style={{ fontSize: 15 }}>
                  {fullName.trim() || session.user.email}
                </strong>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <AdminStatusBadge
                    status="ativo"
                    label={member.role_name ?? roleNameFor(member.role)}
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
                  placeholder="Seu nome na oficina" id="admin-views-accountview-715"
                />
              </label>

              <label className="admin-field">
                E-mail de acesso
                <input className="admin-input" value={session.user.email ?? ""} readOnly id="admin-views-accountview-725" />
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
                  <strong>{member.role_name ?? roleNameFor(member.role)}</strong>
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
                    required id="admin-views-accountview-791"
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
                    required id="admin-views-accountview-814"
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
                    placeholder="5511999999999" id="admin-views-accountview-899"
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
                    required={twoFactorStep === "idle"} id="admin-views-accountview-912"
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
                      autoFocus id="admin-views-accountview-926"
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
                            id={`admin-team-role-${m.user_id}`}
                            value={m.role}
                            disabled={busyUserId === m.user_id || member.role !== "owner" || (isSelf && m.role === "owner")}
                            onChange={(e) => void handleRoleChange(m, e.target.value)}
                            style={{ width: "auto", minWidth: 140 }}
                          >
                            {availableRoles.map((opt) => (
                              <option key={opt.role_key} value={opt.role_key}>
                                {opt.name}
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

      {activeTab === "cargos" && isOwner && (
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Cargos e permissões ({roles.length})</h2>
              <p style={{ margin: "5px 0 0", color: "var(--admin-muted)", fontSize: 12 }}>Defina quais áreas cada cargo pode consultar e alterar. O proprietário mantém acesso total.</p>
            </div>
            <button type="button" className="admin-primary" onClick={() => openRoleEditor()}>
              <Plus size={15} /> Criar cargo
            </button>
          </div>
          {teamError && <p className="admin-form-error" style={{ marginBottom: 14 }}>{teamError}</p>}
          {roles.length === 0 ? (
            <div className="admin-empty">
              <strong>Não foi possível carregar os cargos</strong>
              <p>Confira se a migração de cargos configuráveis já foi aplicada no Supabase.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              {roles.map((role) => (
                <article key={role.role_key} className="admin-panel" style={{ margin: 0, padding: 16, display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                    <div>
                      <strong>{role.name}</strong>
                      <div style={{ color: "var(--admin-muted)", fontSize: 12, marginTop: 5 }}>
                        {role.role_key === "owner" ? "Acesso total protegido" : role.is_system ? "Cargo padrão editável" : "Cargo personalizado"}
                      </div>
                    </div>
                    <ShieldCheck size={16} />
                  </div>
                  <div style={{ color: "var(--admin-muted)", fontSize: 12 }}>
                    {role.role_key === "owner"
                      ? "Acesso completo a todas as áreas."
                      : PANEL_PERMISSION_MODULES.filter(({ key }) => role.permissions?.[key]?.read || role.permissions?.["*"]?.read).length + " áreas liberadas"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {role.role_key !== "owner" && (
                      <button type="button" className="admin-secondary" onClick={() => openRoleEditor(role)}>
                        <Pencil size={13} /> Editar permissões
                      </button>
                    )}
                    {!role.is_system && (
                      <button type="button" className="admin-ghost-danger" onClick={() => void handleDeleteRole(role)}>Excluir</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {roleEditorOpen && isOwner && (
        <div className="admin-modal-backdrop role-editor-backdrop" {...modalBackdropProps(() => setRoleEditorOpen(false))}>
          <div className="admin-modal role-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editingRole ? "Editar cargo" : "Criar cargo"}</h2>
                <p>Permissões de escrita também liberam a consulta da área.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setRoleEditorOpen(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <form onSubmit={(event) => void handleSaveRole(event)}>
              <div className="admin-field" style={{ marginBottom: 16 }}>
                <label>Nome do cargo</label>
                <input className="admin-input" required minLength={2} maxLength={60} value={roleName} onChange={(event) => setRoleName(event.target.value)} id="admin-views-accountview-1164" />
              </div>
              <div className="role-permissions-toolbar">
                <div>
                  <strong>Permissões por área</strong>
                  <small>Selecione tudo de uma vez ou ajuste cada coluna.</small>
                </div>
                <div className="role-permissions-bulk-actions">
                  <button type="button" className="admin-secondary" onClick={() => setAllRolePermissions("all")}>Selecionar tudo</button>
                  <button type="button" className="admin-secondary" onClick={() => setAllRolePermissions("read-only")}>Somente leitura</button>
                  <button type="button" className="admin-secondary" onClick={() => setAllRolePermissions("none")}>Limpar todas</button>
                </div>
              </div>
              <div className="admin-table-wrap role-permissions-desktop">
                <table className="admin-table role-permissions-table">
                  <thead>
                    <tr>
                      <th>Área</th>
                      <th>
                        <label className="role-permission-head">
                          <span>Consultar</span>
                          <Checkbox aria-label="Selecionar consulta em todas as áreas" checked={readColumnChecked} onCheckedChange={(checked) => setRolePermissionColumn("read", checked === true)} />
                        </label>
                      </th>
                      <th>
                        <label className="role-permission-head">
                          <span>Alterar</span>
                          <Checkbox aria-label="Selecionar alteração em todas as áreas" checked={writeColumnChecked} onCheckedChange={(checked) => setRolePermissionColumn("write", checked === true)} />
                        </label>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {PANEL_PERMISSION_MODULES.map(({ key, label }) => (
                      <tr key={key}>
                        <td>{label}</td>
                        <td><Checkbox aria-label={`Consultar: ${label}`} checked={rolePermissions[key]?.read === true} onCheckedChange={(checked) => setRolePermission(key, "read", checked === true)} /></td>
                        <td><Checkbox aria-label={`Alterar: ${label}`} checked={rolePermissions[key]?.write === true} onCheckedChange={(checked) => setRolePermission(key, "write", checked === true)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="role-permissions-mobile" aria-label="Permissões por área">
                {PANEL_PERMISSION_MODULES.map(({ key, label }) => (
                  <article className="role-permission-card" key={key}>
                    <strong>{label}</strong>
                    <div className="role-permission-card-options">
                      <label className="role-permission-toggle">
                        <span>Consultar</span>
                        <Checkbox aria-label={`Consultar: ${label}`} checked={rolePermissions[key]?.read === true} onCheckedChange={(checked) => setRolePermission(key, "read", checked === true)} />
                      </label>
                      <label className="role-permission-toggle">
                        <span>Alterar</span>
                        <Checkbox aria-label={`Alterar: ${label}`} checked={rolePermissions[key]?.write === true} onCheckedChange={(checked) => setRolePermission(key, "write", checked === true)} />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
              {teamError && <p className="admin-form-error">{teamError}</p>}
              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setRoleEditorOpen(false)}>Cancelar</button>
                <button type="submit" className="admin-primary" disabled={savingRole}>{savingRole ? "Salvando…" : "Salvar cargo"}</button>
              </div>
            </form>
          </div>
        </div>
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
                  <input className="admin-input" required maxLength={120} value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} id="admin-views-accountview-1206" />
                </div>
                <div className="admin-field wide">
                  <label>E-mail</label>
                  <input className="admin-input" type="email" required maxLength={254} value={newMemberEmail} onChange={(event) => setNewMemberEmail(event.target.value)} id="admin-views-accountview-1210" />
                </div>
                <div className="admin-field wide">
                  <label>Senha inicial (mínimo 12 caracteres)</label>
                  <input className="admin-input" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newMemberPassword} onChange={(event) => setNewMemberPassword(event.target.value)} id="admin-views-accountview-1214" />
                </div>
                <div className="admin-field wide">
                  <label>Cargo</label>
                  <select className="admin-select" value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value)} id="admin-views-accountview-1218">
                    {availableRoles.map((role) => <option key={role.role_key} value={role.role_key}>{role.name}</option>)}
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

      {activeTab === "auditoria" && canAccessAudit && (
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
                style={{ minHeight: 34 }} id="admin-views-accountview-1238"
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
                  {auditPage.map((entry) => (
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
          {auditPagination}
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
                    placeholder="Nome do colaborador" id="admin-views-accountview-1313"
                  />
                </label>
                <label className="admin-field wide">
                  Perfil de acesso
                  <select
                    className="admin-select"
                    value={editMemberRole}
                    disabled={member.role !== "owner"}
                    onChange={(e) => setEditMemberRole(e.target.value)} id="admin-views-accountview-1322"
                  >
                    {availableRoles.map((opt) => (
                      <option key={opt.role_key} value={opt.role_key}>
                        {opt.name}
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
