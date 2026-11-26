import { NextResponse } from "next/server";
import { getServiceSupabase } from "../../../../lib/supabaseAdmin";

const BUCKET = "site-gallery";
const PAGE_SIZE = 12;
const SELECT_COLUMNS = "id,title,alt_text,caption,media_type,mime_type,asset_source,storage_path,local_path,show_on_home,gallery_order,home_order";

export async function GET(request: Request) {
  try {
    const requestedPage = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const from = (page - 1) * PAGE_SIZE;

    const service = getServiceSupabase();
    const { data, count, error } = await service
      .from("site_gallery_media")
      .select(SELECT_COLUMNS, { count: "exact" })
      .eq("status", "published")
      .eq("is_published", true)
      .order("gallery_order", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const items = (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      alt_text: row.alt_text,
      caption: row.caption,
      media_type: row.media_type,
      mime_type: row.mime_type,
      show_on_home: row.show_on_home,
      gallery_order: row.gallery_order,
      home_order: row.home_order,
      url: row.asset_source === "local" && row.local_path
        ? row.local_path
        : row.storage_path
          ? service.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl
          : "",
    })).filter((item) => Boolean(item.url));

    const totalItems = count ?? items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    return NextResponse.json({ items, page, pageSize: PAGE_SIZE, totalItems, totalPages }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar a galeria." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
