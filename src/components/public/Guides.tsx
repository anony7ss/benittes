import Link from "next/link";
import { guias } from "@/config/oficina";
import { Icon } from "./Icon";

export function Guides() {
  return (
    <div className="rows">
      {guias.map((guia) => (
        <Link key={guia.slug} className="guide" href={`/servicos/${guia.slug}/`}>
          <Icon name={guia.icone} size={27} />
          <strong>{guia.nome}</strong>
        </Link>
      ))}
    </div>
  );
}
