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

type GalleryResponse = {
  items?: GalleryMedia[];
  totalItems?: number;
  totalPages?: number;
};

const PAGE_SIZE = 12;

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
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(fallbackItems.length);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/gallery?page=${page}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Galeria indisponível");
        return response.json() as Promise<GalleryResponse>;
      })
      .then((body) => {
        if (!active || !Array.isArray(body.items)) return;
        const nextItems = body.items.filter((item) => item?.id && item?.url && (item.media_type === "image" || item.media_type === "video"));
        const nextTotalItems = Number.isFinite(body.totalItems) ? Math.max(0, body.totalItems as number) : nextItems.length;
        const nextTotalPages = Number.isFinite(body.totalPages)
          ? Math.max(1, body.totalPages as number)
          : Math.max(1, Math.ceil(nextTotalItems / PAGE_SIZE));

        setTotalItems(nextTotalItems);
        setTotalPages(nextTotalPages);
        if (page > nextTotalPages) {
          setPage(nextTotalPages);
          return;
        }
        setItems(nextItems);
      })
      .catch(() => {
        // Keep the editorial gallery available if the media service is temporarily offline.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page]);

  const visiblePageCount = Math.min(totalPages, 5);
  const firstVisiblePage = Math.max(1, Math.min(page - 2, totalPages - visiblePageCount + 1));
  const pageNumbers = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index);
  const firstItem = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);

  function openMedia(item: GalleryMedia) {
    setSelected(item);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <div className="gallery" aria-busy={loading}>
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

      {totalPages > 1 && (
        <div className="gallery-pagination">
          <p className="gallery-pagination-info" aria-live="polite">
            Mostrando {firstItem}–{lastItem} de {totalItems} itens
          </p>
          <nav className="gallery-pagination-controls" aria-label="Paginação da galeria" aria-busy={loading}>
            <button
              type="button"
              className="gallery-page-button gallery-page-direction"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Página anterior"
            >
              Anterior
            </button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className="gallery-page-button"
                onClick={() => setPage(pageNumber)}
                disabled={loading}
                aria-label={`Ir para a página ${pageNumber}`}
                aria-current={page === pageNumber ? "page" : undefined}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              className="gallery-page-button gallery-page-direction"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || loading}
              aria-label="Próxima página"
            >
              Próxima
            </button>
          </nav>
        </div>
      )}

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
