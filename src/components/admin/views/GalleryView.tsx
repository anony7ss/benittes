"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleAlert,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { confirmModal } from "../ConfirmDialog";
import { AdminActionMenu } from "../ActionMenu";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_VIDEOS = new Set(["video/mp4", "video/webm", "video/quicktime"]);

type GalleryItem = {
  id: string;
  title: string;
  alt_text: string;
  caption: string;
  media_type: "image" | "video";
  mime_type: string;
  asset_source: "local" | "storage";
  status: "published";
  is_published: boolean;
  show_on_home: boolean;
  gallery_order: number;
  home_order: number;
  url: string;
  created_at: string;
};

type UploadJob = {
  key: string;
  name: string;
  state: "preparing" | "uploading" | "publishing" | "done" | "error";
  progress: number;
  error?: string;
};

type EditableFields = Pick<GalleryItem, "title" | "alt_text" | "caption">;

async function responseJson<T>(response: Response): Promise<T & { error?: string }> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível concluir a ação.");
  return body;
}

function sourceMediaType(file: File): "image" | "video" {
  if (ACCEPTED_IMAGES.has(file.type)) return "image";
  if (ACCEPTED_VIDEOS.has(file.type)) return "video";

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) return "image";
  if (["mp4", "webm", "mov"].includes(extension ?? "")) return "video";
  throw new Error("Formato não suportado. Use JPG, PNG, WebP, MP4, WebM ou MOV.");
}

function imageMimeType(file: File): string {
  if (ACCEPTED_IMAGES.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "";
}

function videoMimeType(file: File): string {
  if (ACCEPTED_VIDEOS.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return "";
}

async function optimizeImage(file: File): Promise<File> {
  if (!imageMimeType(file)) throw new Error("A foto precisa estar em JPG, PNG ou WebP.");
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Este navegador não conseguiu preparar a foto.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Não foi possível converter a foto para WebP."));
      }, "image/webp", 0.86);
    });
    canvas.width = 0;
    canvas.height = 0;
    if (blob.type !== "image/webp") throw new Error("Este navegador não oferece conversão para WebP.");
    if (blob.size > MAX_FILE_BYTES) throw new Error("A foto otimizada ainda excede o limite de 50 MB.");
    const outputName = `${file.name.replace(/\.[^.]+$/, "") || "foto"}.webp`;
    return new File([blob], outputName, { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

function uploadWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (value: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("Cache-Control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new Error("Falha de conexão durante o upload. Tente novamente."));
    xhr.onabort = () => reject(new Error("Upload cancelado."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("O armazenamento recusou o arquivo. Confira o formato e tente novamente."));
    };
    xhr.send(file);
  });
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function GalleryCard({
  item,
  index,
  count,
  homeIndex,
  homeCount,
  busy,
  onUpdate,
  onMove,
  onDelete,
}: {
  item: GalleryItem;
  index: number;
  count: number;
  homeIndex: number;
  homeCount: number;
  busy: boolean;
  onUpdate: (id: string, patch: Partial<EditableFields & Pick<GalleryItem, "is_published" | "show_on_home">>) => Promise<void>;
  onMove: (id: string, scope: "gallery" | "home", direction: "up" | "down") => Promise<void>;
  onDelete: (item: GalleryItem) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableFields>({ title: item.title, alt_text: item.alt_text, caption: item.caption });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({ title: item.title, alt_text: item.alt_text, caption: item.caption });
  }, [item.title, item.alt_text, item.caption]);

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onUpdate(item.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`admin-gallery-card${item.is_published ? "" : " is-hidden"}`}>
      <div className="admin-gallery-preview">
        {item.media_type === "image" ? (
          // Stored uploads and local legacy assets are both served as ordinary public media.
          <img src={item.url} alt={item.alt_text || item.title} loading="lazy" />
        ) : (
          <video src={item.url} controls preload="metadata" playsInline aria-label={item.title} />
        )}
        <span className="admin-gallery-kind">{item.media_type === "image" ? <FileImage size={13} /> : <Video size={13} />}{item.media_type === "image" ? "Foto" : "Vídeo"}</span>
        {!item.is_published && <span className="admin-gallery-hidden-label">Oculto do site</span>}
      </div>

      <div className="admin-gallery-card-body">
        <div className="admin-gallery-card-heading">
          <div>
            <strong title={item.title}>{item.title}</strong>
            <span>Galeria · posição {index + 1} de {count}</span>
          </div>
          <AdminActionMenu
            label={`Ações de ${item.title}`}
            actions={[
              { label: editing ? "Fechar edição" : "Editar detalhes", icon: editing ? <X size={14} /> : <Pencil size={14} />, onSelect: () => setEditing((value) => !value) },
              { label: "Remover da galeria", icon: <Trash2 size={14} />, onSelect: () => void onDelete(item), destructive: true, disabled: busy, separatorBefore: true },
            ]}
          />
        </div>

        <div className="admin-gallery-controls">
          <label className="admin-gallery-toggle">
            <Checkbox checked={item.is_published} disabled={busy} onCheckedChange={(checked) => void onUpdate(item.id, { is_published: checked === true })} />
            <span>Publicada</span>
          </label>
          {item.media_type === "image" && (
            <label className={`admin-gallery-toggle${!item.is_published ? " disabled" : ""}`}>
              <Checkbox checked={item.show_on_home} disabled={busy || !item.is_published} onCheckedChange={(checked) => void onUpdate(item.id, { show_on_home: checked === true })} />
              <span>Na home</span>
            </label>
          )}
        </div>

        <div className="admin-gallery-order-row">
          <span>Ordem da galeria</span>
          <div>
            <button type="button" className="admin-gallery-order-btn" disabled={busy || index === 0 || !item.is_published} onClick={() => void onMove(item.id, "gallery", "up")} aria-label="Subir na galeria" title="Subir na galeria"><ArrowUp size={15} /></button>
            <button type="button" className="admin-gallery-order-btn" disabled={busy || index === count - 1 || !item.is_published} onClick={() => void onMove(item.id, "gallery", "down")} aria-label="Descer na galeria" title="Descer na galeria"><ArrowDown size={15} /></button>
          </div>
        </div>

        {item.media_type === "image" && item.show_on_home && item.is_published && (
          <div className="admin-gallery-order-row">
            <span>Ordem na home · {homeIndex + 1} de {homeCount}</span>
            <div>
              <button type="button" className="admin-gallery-order-btn" disabled={busy || homeIndex === 0} onClick={() => void onMove(item.id, "home", "up")} aria-label="Subir na home" title="Subir na home"><ArrowUp size={15} /></button>
              <button type="button" className="admin-gallery-order-btn" disabled={busy || homeIndex === homeCount - 1} onClick={() => void onMove(item.id, "home", "down")} aria-label="Descer na home" title="Descer na home"><ArrowDown size={15} /></button>
            </div>
          </div>
        )}

        {editing && (
          <form className="admin-gallery-edit" onSubmit={(event) => void saveDetails(event)}>
            <label className="admin-field">
              <span>Título</span>
              <input className="admin-input" maxLength={120} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} required />
            </label>
            {item.media_type === "image" && (
              <label className="admin-field">
                <span>Texto alternativo</span>
                <input className="admin-input" maxLength={240} value={draft.alt_text} onChange={(event) => setDraft((value) => ({ ...value, alt_text: event.target.value }))} />
              </label>
            )}
            <label className="admin-field">
              <span>Legenda</span>
              <textarea className="admin-textarea" rows={2} maxLength={500} value={draft.caption} onChange={(event) => setDraft((value) => ({ ...value, caption: event.target.value }))} />
            </label>
            <button type="submit" className="admin-primary" disabled={saving}><Check size={15} /> Salvar detalhes</button>
          </form>
        )}
      </div>
    </article>
  );
}

export function GalleryView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const loadItems = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/gallery", { credentials: "same-origin", cache: "no-store" });
      const body = await responseJson<{ items: GalleryItem[] }>(response);
      setItems(body.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar a galeria.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const homeItems = useMemo(
    () => items.filter((item) => item.is_published && item.show_on_home && item.media_type === "image").sort((a, b) => a.home_order - b.home_order),
    [items],
  );
  const publicItems = useMemo(
    () => items.filter((item) => item.is_published).sort((a, b) => a.gallery_order - b.gallery_order),
    [items],
  );

  function updateJob(key: string, patch: Partial<UploadJob>) {
    setJobs((current) => current.map((job) => job.key === key ? { ...job, ...patch } : job));
  }

  async function processFile(file: File) {
    const key = crypto.randomUUID();
    const mediaType = sourceMediaType(file);
    const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || (mediaType === "image" ? "Nova foto" : "Novo vídeo");
    setJobs((current) => [...current, { key, name: file.name, state: "preparing", progress: 0 }]);
    let itemId = "";
    let uploadSucceeded = false;

    try {
      if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error("O arquivo original precisa ter até 50 MB.");
      const prepared = mediaType === "image" ? await optimizeImage(file) : file;
      const mimeType = mediaType === "image" ? prepared.type : videoMimeType(prepared);
      if (!mimeType) throw new Error("Formato de vídeo não suportado. Use MP4, WebM ou MOV.");
      if (prepared.size > MAX_FILE_BYTES) throw new Error("O arquivo otimizado excede 50 MB.");

      updateJob(key, { state: "uploading", progress: 0 });
      const intentResponse = await fetch("/api/admin/gallery", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          alt_text: title,
          caption: "",
          media_type: mediaType,
          mime_type: mimeType,
          size: prepared.size,
        }),
      });
      const intent = await responseJson<{ id: string; upload_url: string; upload_headers: Record<string, string> }>(intentResponse);
      itemId = intent.id;
      await uploadWithProgress(intent.upload_url, intent.upload_headers ?? {}, prepared, (progress) => updateJob(key, { progress }));
      uploadSucceeded = true;

      updateJob(key, { state: "publishing", progress: 100 });
      const finalizeResponse = await fetch("/api/admin/gallery/finalize", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      });
      await responseJson<{ ok: boolean }>(finalizeResponse);
      updateJob(key, { state: "done", progress: 100 });
      setFeedback("Arquivo publicado na galeria.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Falha ao enviar o arquivo.";
      updateJob(key, { state: "error", error: message });
      if (itemId) {
        await fetch(`/api/admin/gallery/item?id=${encodeURIComponent(itemId)}`, {
          method: "DELETE",
          credentials: "same-origin",
        }).catch(() => undefined);
      }
      if (!uploadSucceeded) setError(message);
    } finally {
      await loadItems();
    }
  }

  async function handleFiles(files: FileList | File[]) {
    setError("");
    setFeedback("");
    const selected = Array.from(files).slice(0, 20);
    if (files.length > 20) setError("Selecione até 20 arquivos por envio.");
    for (const file of selected) {
      try {
        await processFile(file);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Arquivo inválido.");
      }
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files?.length) void handleFiles(files);
    event.currentTarget.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
  }

  async function updateItem(id: string, patch: Partial<EditableFields & Pick<GalleryItem, "is_published" | "show_on_home">>) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch("/api/admin/gallery/item", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...patch }),
      });
      await responseJson<{ ok: boolean }>(response);
      setItems((current) => current.map((item) => item.id === id ? {
        ...item,
        ...patch,
        ...("is_published" in patch && patch.is_published === false ? { show_on_home: false } : {}),
      } : item));
      setFeedback("Galeria atualizada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o item.");
    } finally {
      setBusyId(null);
    }
  }

  async function moveItem(id: string, scope: "gallery" | "home", direction: "up" | "down") {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch("/api/admin/gallery/item", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", id, scope, direction }),
      });
      await responseJson<{ ok: boolean }>(response);
      await loadItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a ordem.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeItem(item: GalleryItem) {
    const accepted = await confirmModal({
      title: "Remover item da galeria",
      message: `A foto ou vídeo “${item.title}” deixará de aparecer no site.`,
      confirmLabel: "Remover",
      danger: true,
    });
    if (!accepted) return;
    setBusyId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/gallery/item?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      await responseJson<{ ok: boolean }>(response);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setFeedback("Item removido da galeria.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o item.");
      await loadItems();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Galeria</h1>
        </div>
        <div className="admin-title-actions">
          <a className="admin-secondary" href="/galeria/" target="_blank" rel="noopener noreferrer">Ver galeria pública</a>
          <button type="button" className="admin-secondary" onClick={() => void loadItems()} disabled={loading}><RefreshCw size={15} /> Atualizar</button>
          <button type="button" className="admin-primary" onClick={() => fileInputRef.current?.click()}><ImagePlus size={16} /> Adicionar mídia</button>
          <input ref={fileInputRef} className="admin-gallery-file-input" type="file" name="gallery-files" id="gallery-files" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple onChange={onInputChange} />
        </div>
      </div>

      <section
        className={`admin-gallery-dropzone${isDragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
        onDrop={onDrop}
      >
        <div className="admin-gallery-drop-icon"><Upload size={19} /></div>
        <div>
          <strong>Envie fotos ou vídeos da oficina</strong>
          <p>As fotos são convertidas para WebP e reduzidas automaticamente. Vídeos mantêm o formato original.</p>
          <small>Até 50 MB por arquivo · JPG, PNG, WebP, MP4, WebM ou MOV</small>
        </div>
        <button type="button" className="admin-secondary" onClick={() => fileInputRef.current?.click()}>Escolher arquivos</button>
      </section>

      {error && <p className="admin-form-error" role="alert"><CircleAlert size={15} /> {error}</p>}
      {feedback && <p className="admin-form-success" role="status"><CheckCircle2 size={15} /> {feedback}</p>}

      {jobs.length > 0 && (
        <section className="admin-gallery-queue" aria-label="Envios recentes" aria-live="polite">
          <div className="admin-gallery-section-title"><h2>Envios recentes</h2><span>{jobs.filter((job) => job.state === "done").length} concluído(s)</span></div>
          {jobs.slice(-6).map((job) => {
            const active = job.state === "preparing" || job.state === "uploading" || job.state === "publishing";
            return (
              <div className={`admin-gallery-job ${job.state}`} key={job.key}>
                <div className="admin-gallery-job-icon">
                  {job.state === "done" ? <CheckCircle2 size={17} /> : job.state === "error" ? <CircleAlert size={17} /> : <LoaderCircle size={17} className={active ? "admin-gallery-spinner" : ""} />}
                </div>
                <div className="admin-gallery-job-main">
                  <div className="admin-gallery-job-copy"><strong>{job.name}</strong><span>{job.error ?? (job.state === "preparing" ? "Otimizando foto…" : job.state === "uploading" ? `Enviando · ${job.progress}%` : job.state === "publishing" ? "Finalizando publicação…" : "Publicado")}</span></div>
                  {job.state === "uploading" && <div className="admin-gallery-progress-track"><span style={{ width: `${job.progress}%` }} /></div>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="admin-gallery-overview" aria-label="Resumo da galeria">
        <div><span>Publicadas</span><strong>{publicItems.length}</strong></div>
        <div><span>Fotos na home</span><strong>{homeItems.length}</strong></div>
        <div><span>Fotos</span><strong>{items.filter((item) => item.media_type === "image").length}</strong></div>
        <div><span>Vídeos</span><strong>{items.filter((item) => item.media_type === "video").length}</strong></div>
      </section>

      <div className="admin-gallery-list-heading">
        <div><h2>Conteúdo da galeria</h2><p>Use as posições para definir a sequência pública. Fotos marcadas para a home têm uma ordem independente.</p></div>
        <span>{items.length} {items.length === 1 ? "item" : "itens"}</span>
      </div>

      {loading ? (
        <div className="admin-gallery-grid" aria-busy="true" aria-label="Carregando galeria">
          {[0, 1, 2].map((item) => <div className="admin-gallery-skeleton" key={item}><div /><span /><span /></div>)}
        </div>
      ) : items.length === 0 ? (
        <div className="admin-empty"><ImagePlus size={25} /><strong>Nenhuma mídia na galeria</strong><p>Adicione fotos ou vídeos para começar a organizar o conteúdo do site.</p></div>
      ) : (
        <div className="admin-gallery-grid">
          {items.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              index={publicItems.findIndex((entry) => entry.id === item.id)}
              count={publicItems.length}
              homeIndex={homeItems.findIndex((entry) => entry.id === item.id)}
              homeCount={homeItems.length}
              busy={busyId === item.id}
              onUpdate={updateItem}
              onMove={moveItem}
              onDelete={removeItem}
            />
          ))}
        </div>
      )}
    </>
  );
}
