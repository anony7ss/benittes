"use client";

import { useEffect, useState } from "react";

export function usePagination<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [items]);

  const controls = items.length > pageSize ? (
    <nav className="admin-pagination" aria-label="Paginação">
      <span>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, items.length)} de {items.length}</span>
      <div>
        <button type="button" className="admin-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
        <span>Página {currentPage} de {pageCount}</span>
        <button type="button" className="admin-secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button>
      </div>
    </nav>
  ) : null;

  return { pageItems, controls };
}
