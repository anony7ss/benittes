"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { fotos } from "@/config/oficina";
import { Photo } from "./Photo";

const carouselFotos = [fotos[1], fotos[2], fotos[0]];

export function PhotoCarousel({
  leftIcon,
  rightIcon,
}: {
  leftIcon: ReactNode;
  rightIcon: ReactNode;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hasChangedPhoto, setHasChangedPhoto] = useState(false);

  const step = (delta: number) => {
    setDirection(delta > 0 ? 1 : -1);
    setHasChangedPhoto(true);
    setActiveIndex((prev) => (prev + delta + carouselFotos.length) % carouselFotos.length);
  };

  const selectPhoto = (index: number) => {
    if (index === activeIndex) return;
    const nextDistance = (index - activeIndex + carouselFotos.length) % carouselFotos.length;
    const previousDistance = (activeIndex - index + carouselFotos.length) % carouselFotos.length;
    setDirection(nextDistance <= previousDistance ? 1 : -1);
    setHasChangedPhoto(true);
    setActiveIndex(index);
  };
  const activeSlideClass = (index: number) => {
    if (index !== activeIndex || !hasChangedPhoto) return "carousel-slide";
    return direction > 0 ? "carousel-slide entering-next" : "carousel-slide entering-previous";
  };

  return (
    <div
      className="photo-carousel"
      aria-label="Fotos da oficina"
      aria-roledescription="carrossel"
    >
      <div className="carousel-stage">
        {carouselFotos.map((foto, index) => (
          <figure
            key={foto.id}
            className={activeSlideClass(index)}
            role="group"
            aria-roledescription="slide"
            aria-label={`Foto ${index + 1} de ${carouselFotos.length}`}
            hidden={index !== activeIndex}
          >
            <Link href={`/galeria/#${foto.id}`} aria-label={`Abrir ${foto.nome} na galeria`}>
              <Photo
                id={foto.id}
                priority={index === 0}
                sizes="(max-width: 820px) 100vw, 85vw"
              />
            </Link>
          </figure>
        ))}
      </div>
      <div className="carousel-controls">
        <div className="carousel-dots" role="group" aria-label="Selecionar foto">
          {carouselFotos.map((foto, index) => (
            <button
              key={foto.id}
              className="carousel-dot"
              type="button"
              aria-label={`Mostrar foto: ${foto.nome}`}
              aria-current={index === activeIndex ? "true" : "false"}
              onClick={() => selectPhoto(index)}
            />
          ))}
        </div>
        <p className="visually-hidden" aria-live="polite">
          Foto {activeIndex + 1} de {carouselFotos.length}
        </p>
        <div className="carousel-arrows" role="group" aria-label="Navegar pelas fotos">
          <button
            className="carousel-arrow"
            type="button"
            aria-label="Foto anterior"
            onClick={() => step(-1)}
          >
            {leftIcon}
          </button>
          <button
            className="carousel-arrow"
            type="button"
            aria-label="Próxima foto"
            onClick={() => step(1)}
          >
            {rightIcon}
          </button>
        </div>
      </div>
    </div>
  );
}
