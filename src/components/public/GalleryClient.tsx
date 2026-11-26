"use client";

import { useRef, useState, type ReactNode } from "react";
import { fotos } from "@/config/oficina";
import { Photo } from "./Photo";

export function GalleryClient({ closeIcon }: { closeIcon: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<{ id: string; alt: string; caption: string } | null>(
    null,
  );

  function openPhoto(foto: (typeof fotos)[number]) {
    setSelected({ id: foto.id, alt: foto.alt, caption: foto.nome });
    dialogRef.current?.showModal();
  }

  return (
    <>
      <div className="gallery">
        {fotos.map((f, i) => (
          <figure key={f.id} id={f.id}>
            <button
              type="button"
              className="zoom"
              aria-label={`Ampliar: ${f.nome}`}
              onClick={() => openPhoto(f)}
            >
              <Photo
                id={f.id}
                priority={i === 0}
                sizes={i === 0 ? "(max-width:680px) 100vw, 60vw" : "(max-width:680px) 48vw, 38vw"}
              />
            </button>
            <figcaption>
              <strong>{f.nome}</strong> {f.detalhe}
            </figcaption>
          </figure>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Fotografia ampliada"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form method="dialog">
          <button className="btn white">
            Fechar {closeIcon}
          </button>
        </form>
        {selected && <img src={`/media/${selected.id}-1536.webp`} alt={selected.alt} />}
        <p>{selected?.caption ?? ""}</p>
      </dialog>
    </>
  );
}
