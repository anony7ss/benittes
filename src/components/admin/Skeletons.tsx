"use client";

export function SkeletonBox({
  width = "100%",
  height = 16,
  radius = 8,
}: {
  width?: string | number;
  height?: number;
  radius?: number;
}) {
  return (
    <div
      className="admin-skeleton"
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <section
      className={`admin-stat-grid${count === 3 ? " admin-stat-grid-trio" : ""}`}
      role="status"
      aria-label="Carregando indicadores"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="admin-stat-card" aria-hidden="true">
          <div className="admin-stat-card-head">
            <SkeletonBox height={11} width="58%" radius={4} />
            <SkeletonBox height={22} width={22} radius={6} />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <SkeletonBox height={28} width={112} radius={6} />
            <SkeletonBox height={12} width="72%" radius={4} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function SkeletonChart({
  variant = "bars",
  height = 220,
}: {
  variant?: "bars" | "donut";
  height?: number;
}) {
  return (
    <div
      role="status"
      aria-label="Carregando gráfico"
      aria-busy="true"
      style={{ height, display: "grid", alignItems: "center" }}
    >
      {variant === "donut" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", gap: 18 }} aria-hidden="true">
          <div style={{ display: "grid", placeItems: "center" }}>
            <SkeletonBox width={124} height={124} radius={999} />
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {["72%", "88%", "58%", "76%"].map((width, index) => (
              <div key={index} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SkeletonBox width={10} height={10} radius={999} />
                <SkeletonBox width={width} height={11} radius={4} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", gap: 10, height: "100%", padding: "20px 8px 4px" }} aria-hidden="true">
          {[34, 58, 44, 76, 52, 88, 64, 46].map((barHeight, index) => (
            <div key={index} style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", height: "100%", flex: "1 1 0" }}>
              <SkeletonBox width="72%" height={barHeight} radius={4} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkeletonDashboardRows({
  count = 4,
  variant = "record",
}: {
  count?: number;
  variant?: "metric" | "record" | "alert";
}) {
  return (
    <div
      className={`admin-dashboard-data-list ${variant === "alert" ? "admin-dashboard-alert-list" : ""}`}
      role="status"
      aria-label="Carregando registros"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div className="admin-dashboard-row-skeleton" key={index} aria-hidden="true">
          {variant === "alert" ? (
            <>
              <SkeletonBox width={16} height={16} radius={4} />
              <div style={{ display: "grid", gap: 6, flex: 1 }}>
                <SkeletonBox width="58%" height={12} radius={4} />
                <SkeletonBox width="38%" height={10} radius={4} />
              </div>
              <SkeletonBox width={36} height={13} radius={4} />
            </>
          ) : variant === "metric" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <SkeletonBox width={16} height={16} radius={4} />
                <SkeletonBox width="58%" height={13} radius={4} />
              </div>
              <SkeletonBox width={28} height={16} radius={4} />
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 7, flex: 1 }}>
                <SkeletonBox width="62%" height={13} radius={4} />
                <SkeletonBox width="48%" height={11} radius={4} />
              </div>
              <SkeletonBox width={58} height={22} radius={999} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="admin-table-wrap" style={{ padding: 18 }}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1fr 0.7fr", gap: 14 }}>
          <SkeletonBox height={12} width="60%" />
          <SkeletonBox height={12} width="50%" />
          <SkeletonBox height={12} width="45%" />
          <SkeletonBox height={12} width="55%" />
          <SkeletonBox height={12} width="40%" />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1.2fr 1fr 1fr 0.7fr",
              gap: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--admin-line)",
            }}
          >
            <SkeletonBox height={16} width="78%" />
            <SkeletonBox height={16} width="65%" />
            <SkeletonBox height={16} width="60%" />
            <SkeletonBox height={22} width={84} radius={999} />
            <SkeletonBox height={16} width={52} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="admin-three-col">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="admin-panel" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <SkeletonBox height={28} width={120} radius={8} />
            <SkeletonBox height={22} width={74} radius={999} />
          </div>
          <SkeletonBox height={18} width="70%" />
          <SkeletonBox height={13} width="52%" />
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--admin-line)" }}>
            <SkeletonBox height={16} width={80} />
            <SkeletonBox height={28} width={68} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonKanban({ columns = 3 }: { columns?: number }) {
  return (
    <div className="admin-kanban">
      {Array.from({ length: columns }).map((_, col) => (
        <div key={col} className="admin-lane">
          <div className="admin-lane-head">
            <SkeletonBox height={14} width={96} />
            <SkeletonBox height={24} width={24} radius={999} />
          </div>
          {Array.from({ length: 2 }).map((__, card) => (
            <div key={card} className="admin-kanban-card">
              <SkeletonBox height={24} width={110} radius={6} />
              <SkeletonBox height={16} width="85%" />
              <SkeletonBox height={12} width="60%" />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--admin-line)" }}>
                <SkeletonBox height={15} width={70} />
                <SkeletonBox height={24} width={60} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonInbox() {
  return (
    <div className="admin-inbox">
      <div className="admin-inbox-list" style={{ padding: 14, display: "grid", gap: 14 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "grid", gap: 8, paddingBottom: 12, borderBottom: "1px solid var(--admin-line)" }}>
            <SkeletonBox height={15} width="65%" />
            <SkeletonBox height={12} width="90%" />
          </div>
        ))}
      </div>
      <div className="admin-inbox-detail">
        <SkeletonBox height={22} width="45%" />
        <SkeletonBox height={13} width="30%" />
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <SkeletonBox height={14} width="95%" />
          <SkeletonBox height={14} width="88%" />
          <SkeletonBox height={14} width="72%" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="admin-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div style={{ display: "grid", gap: 8, flex: 1 }}>
            <SkeletonBox height={16} width="42%" />
            <SkeletonBox height={12} width="64%" />
          </div>
          <SkeletonBox height={28} width={88} radius={999} />
        </div>
      ))}
    </div>
  );
}
