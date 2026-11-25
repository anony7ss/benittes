import Link from "next/link";

export function Mark() {
  return (
    <Link className="brand" href="/" aria-label="Benittes Oficina Mecânica — início">
      <img
        className="brand-logo"
        src="/benittes-logo.png"
        alt="Benittes Oficina Mecânica"
        width={1000}
        height={798}
        decoding="async"
      />
    </Link>
  );
}
