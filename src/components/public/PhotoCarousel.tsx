"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fotos } from "@/config/oficina";

type HomePhoto = {
  id: string;
  title: string;
  alt_text: string;
  media_type: "image";
  url: string;
};

const fallbackPhotos: HomePhoto[] = [fotos[1], fotos[2], fotos[0]].map((foto) => ({
  id: foto.id,
  title: foto.nome,
  alt_text: foto.alt,
  media_type: "image",
  url: `/media/${foto.id}-1120.webp`,
}));

export function PhotoCarousel({
  leftIcon,
  rightIcon,
}: {
  leftIcon: ReactNode;
  rightIcon: ReactNode;
}) {
  const [photos, setPhotos] = useState<HomePhoto[]>(fallbackPhotos);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hasChangedPhoto, setHasChangedPhoto] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/public/gallery", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Galeria indisponível");
        return response.json() as Promise<{ items?: Array<HomePhoto & { show_on_home?: boolean; home_order?: number }> }>;
      })
      .then((body) => {
        if (!active || !Array.isArray(body.items)) return;
        const configured = body.items
          .filter((item) => item.media_type === "image" && item.show_on_home && item.url)
          .sort((a, b) => (a.home_order ?? 0) - (b.home_order ?? 0));
        setPhotos(configured);
        setActiveIndex(0);
      })
      .catch(() => {
        // Preserve the original home carousel if the gallery service is temporarily offline.
      });
    return () => { active = false; };
  }, []);

  const step = (delta: number) => {
    if (photos.length < 2) return;
    setDirection(delta > 0 ? 1 : -1);
    setHasChangedPhoto(true);
    setActiveIndex((previous) => (previous + delta + photos.length) % photos.length);
  };

  const selectPhoto = (index: number) => {
    if (index === activeIndex || index < 0 || index >= photos.length) return;
    const nextDistance = (index - activeIndex + photos.length) % photos.length;
    const previousDistance = (activeIndex - index + photos.length) % photos.length;
    setDirection(nextDistance <= previousDistance ? 1 : -1);
    setHasChangedPhoto(true);
    setActiveIndex(index);
  };

  if (photos.length === 0) return null;

  return (
    <div className="photo-carousel" aria-label="Fotos da oficina" aria-roledescription="carrossel">
      <div className="carousel-stage">
        {photos.map((photo, index) => {
          const activeSlideClass = index !== activeIndex || !hasChangedPhoto
            ? "carousel-slide"
            : direction > 0 ? "carousel-slide entering-next" : "carousel-slide entering-previous";
          return (
            <figure
              key={photo.id}
              className={activeSlideClass}
              role="group"
              aria-roledescription="slide"
              aria-label={`Foto ${index + 1} de ${photos.length}`}
              hidden={index !== activeIndex}
            >
              <Link href={`/galeria/#${encodeURIComponent(photo.id)}`} aria-label={`Abrir ${photo.title} na galeria`}>
                <picture>
                  <img
                    src={photo.url}
                    alt={photo.alt_text || photo.title}
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                    decoding="async"
                    width={1536}
                    height={1024}
                    sizes="(max-width: 820px) 100vw, 85vw"
                  />
                </picture>
              </Link>
            </figure>
          );
        })}
      </div>
      <div className="carousel-controls">
        <div className="carousel-dots" role="group" aria-label="Selecionar foto">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              className="carousel-dot"
              type="button"
              aria-label={`Mostrar foto: ${photo.title}`}
              aria-current={index === activeIndex ? "true" : "false"}
              onClick={() => selectPhoto(index)}
            />
          ))}
        </div>
        <p className="visually-hidden" aria-live="polite">Foto {activeIndex + 1} de {photos.length}</p>
        {photos.length > 1 && (
          <div className="carousel-arrows" role="group" aria-label="Navegar pelas fotos">
            <button className="carousel-arrow" type="button" aria-label="Foto anterior" onClick={() => step(-1)}>{leftIcon}</button>
            <button className="carousel-arrow" type="button" aria-label="Próxima foto" onClick={() => step(1)}>{rightIcon}</button>
          </div>
        )}
      </div>
    </div>
  );
}
