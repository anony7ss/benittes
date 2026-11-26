"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fotos } from "@/config/oficina";

type GalleryMedia = {
  id: string;
  title: string;
  alt_text: string;
  caption: string;
  media_type: "image" | "video";
  url: string;
};

const fallbackItems: GalleryMedia[] = fotos.map((foto) => ({
  id: foto.id,
  title: foto.nome,
  alt_text: foto.alt,
  caption: foto.detalhe,
  media_type: "image",
  url: `/media/${foto.id}-1536.webp`,
}));

export function GalleryClient({ closeIcon }: { closeIcon: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<GalleryMedia[]>(fallbackItems);
  const [selected, setSelected] = useState<GalleryMedia | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/public/gallery", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Galeria indisponível");
        return response.json() as Promise<{ items?: GalleryMedia[] }>;
      })
      .then((body) => {
        if (!active || !Array.isArray(body.items)) return;
        setItems(body.items.filter((item) => item?.id && item?.url && (item.media_type === "image" || item.media_type === "video")));
      })
      .catch(() => {
        // Keep the editorial gallery available if the media service is temporarily offline.
      });
    return () => { active = false; };
  }, []);

  function openMedia(item: GalleryMedia) {
    setSelected(item);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <div className="gallery">
        {items.map((item, index) => (
          <figure key={item.id} id={item.id}>
            <button
              type="button"
              className="zoom"
              aria-label={`${item.media_type === "image" ? "Ampliar foto" : "Abrir vídeo"}: ${item.title}`}
              onClick={() => openMedia(item)}
            >
              {item.media_type === "image" ? (
                <picture>
                  <img src={item.url} alt={item.alt_text || item.title} loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "auto"} decoding="async" width={1536} height={1024} />
                </picture>
              ) : (
                <video src={item.url} aria-label={item.title} preload="metadata" playsInline />
              )}
            </button>
            <figcaption>
              <strong>{item.title}</strong> {item.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Mídia ampliada"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => setSelected(null)}
      >
        <form method="dialog">
          <button className="btn white">
            Fechar {closeIcon}
          </button>
        </form>
        {selected?.media_type === "image" && <img src={selected.url} alt={selected.alt_text || selected.title} />}
        {selected?.media_type === "video" && <video src={selected.url} controls autoPlay playsInline />}
        <p>{selected?.caption || selected?.title || ""}</p>
      </dialog>
    </>
  );
}
