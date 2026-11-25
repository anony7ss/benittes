import type { Metadata } from "next";
import { adminPages, findAdminPage } from "@/admin/navigation";
import AdminApp from "@/components/admin/AdminApp";

export function generateStaticParams() {
  return adminPages
    .filter((page) => Boolean(page.path))
    .map((page) => ({ section: page.path.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string[] }>;
}): Promise<Metadata> {
  const { section } = await params;
  const page = findAdminPage((section ?? []).join("/"));
  return {
    title: page ? `${page.label} · Painel` : "Painel",
    robots: { index: false, follow: false },
  };
}

export default async function PainelSectionPage({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  return <AdminApp section={(section ?? []).join("/")} />;
}
