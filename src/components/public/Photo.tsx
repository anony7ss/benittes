import { fotos } from "@/config/oficina";

export function Photo({
  id,
  priority = false,
  sizes = "100vw",
}: {
  id: string;
  priority?: boolean;
  sizes?: string;
}) {
  const alt = fotos.find((p) => p.id === id)?.alt ?? "";
  const srcSet = [640, 1120, 1800].map((w) => `/media/${id}-${w}.jpg ${w}w`).join(", ");
  const height = id === "cofre" ? 630 : 1680;

  return (
    <picture>
      <img
        src={`/media/${id}-1120.jpg`}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        width={1120}
        height={height}
      />
    </picture>
  );
}
