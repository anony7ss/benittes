"use client";

import { perguntas } from '../config/oficina';

interface Props { limit?: number }

export default function Perguntas({ limit = perguntas.length }: Props) {
  return (
    <div className="faqs">
      {perguntas.slice(0, limit).map(([pergunta, resposta]) => (
        <details key={pergunta}>
          <summary>{pergunta}<span className="expand-symbol" aria-hidden="true">+</span></summary>
          <p>{resposta}</p>
        </details>
      ))}
    </div>
  );
}
