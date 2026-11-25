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
