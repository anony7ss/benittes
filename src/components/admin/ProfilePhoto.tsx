"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "../../lib/supabase";

function readLegacyAvatar(legacyKey: string) {
  try {
    return typeof window === "undefined" ? "" : window.localStorage.getItem(legacyKey) ?? "";
  } catch {
    return "";
  }
}

const PhotoContext = createContext<{
  avatarUrl: string;
  previewPhoto: (photo: string | null) => void;
  restorePhotoPreview: () => void;
  savePhoto: (photo: string | null, preview?: string | null) => Promise<void>;
} | null>(null);

export function useProfilePhoto() {
  const context = useContext(PhotoContext);
  if (!context) throw new Error("Foto fora do contexto da conta.");
  return context;
}

export function ProfilePhotoProvider({
  session,
  initialAvatar,
  children,
}: {
  session: Session;
  initialAvatar: string | null;
  children: ReactNode;
}) {
  const legacyKey = "admin-avatar:" + (session.user.email ?? "").trim().toLowerCase();
  const [avatarUrl, setAvatarUrl] = useState(() => initialAvatar ?? readLegacyAvatar(legacyKey));
  const savedAvatar = useRef(avatarUrl);
  const previewObjectUrl = useRef<string | null>(null);
  const clearPreviewObjectUrl = useCallback(() => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    previewObjectUrl.current = null;
  }, []);

  useEffect(() => {
    const currentAvatar = initialAvatar ?? readLegacyAvatar(legacyKey);
    savedAvatar.current = currentAvatar;
    clearPreviewObjectUrl();
    setAvatarUrl(currentAvatar);
  }, [clearPreviewObjectUrl, initialAvatar, legacyKey]);

  useEffect(() => () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
  }, []);

  function previewPhoto(photo: string | null) {
    clearPreviewObjectUrl();
    if (photo?.startsWith("blob:")) previewObjectUrl.current = photo;
    setAvatarUrl(photo ?? savedAvatar.current);
  }

  function restorePhotoPreview() {
    clearPreviewObjectUrl();
    setAvatarUrl(savedAvatar.current);
  }

  async function savePhoto(photo: string | null, preview?: string | null) {
    const previousAvatar = savedAvatar.current;
    if (preview?.startsWith("blob:")) {
      if (previewObjectUrl.current !== preview) clearPreviewObjectUrl();
      previewObjectUrl.current = preview;
    } else {
      clearPreviewObjectUrl();
    }
    setAvatarUrl(preview === undefined ? photo ?? "" : preview ?? "");
    try {
      const response = await fetch("/api/admin/account/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ photo }),
      });
      if (!response.ok) throw new Error("Não foi possível salvar a foto. Tente novamente.");

      savedAvatar.current = photo ?? "";
      setAvatarUrl(previewObjectUrl.current ?? savedAvatar.current);
      try {
        localStorage.removeItem(legacyKey);
      } catch {
        // A foto já foi atualizada no banco.
      }
    } catch (error) {
      clearPreviewObjectUrl();
      setAvatarUrl(previousAvatar);
      throw error;
    }
  }

  return (
    <PhotoContext.Provider value={{ avatarUrl, previewPhoto, restorePhotoPreview, savePhoto }}>
      {children}
    </PhotoContext.Provider>
  );
}
