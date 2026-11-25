"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "../../lib/supabase";

const PhotoContext = createContext<{
  avatarUrl: string;
  savePhoto: (photo: string | null) => Promise<void>;
} | null>(null);

export function useProfilePhoto() {
  const context = useContext(PhotoContext);
  if (!context) throw new Error("Foto fora do contexto da conta.");
  return context;
}

export function ProfilePhotoProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [avatarUrl, setAvatarUrl] = useState("");
  const revision = useRef(0);
  const token = session.access_token;
  const legacyKey = "admin-avatar:" + (session.user.email ?? "").trim().toLowerCase();

  useEffect(() => {
    const controller = new AbortController();
    const initialRevision = revision.current;
    async function load() {
      const response = await fetch("/api/admin/account/avatar", {
        headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) return;
      const { avatar } = await response.json();
      if (!controller.signal.aborted && initialRevision === revision.current) {
        setAvatarUrl(avatar ? avatar.photo ?? "" : localStorage.getItem(legacyKey) ?? "");
      }
    }
    void load().catch(() => {});
    return () => controller.abort();
  }, [token, legacyKey]);

  async function savePhoto(photo: string | null) {
    const response = await fetch("/api/admin/account/avatar", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ photo }),
    });
    if (!response.ok) throw new Error("Não foi possível salvar a foto. Tente novamente.");
    revision.current++;
    setAvatarUrl(photo ?? "");
    try { localStorage.removeItem(legacyKey); } catch { /* O banco já foi atualizado. */ }
  }

  return <PhotoContext.Provider value={{ avatarUrl, savePhoto }}>{children}</PhotoContext.Provider>;
}
