import supabase from "@/lib/supabase";

// The gallery lists in-stock products first (showing only their in-stock sizes), then sold-out
// products. Pages run across both groups: sold-out products fill the pages after the last
// in-stock one. Used by the server page (first load) and the client (filters, sort, paging).

export const PRODUCTS_PER_PAGE = 60;

export type GalleryFilters = {
  category_id: number | null;
  subcategory_id: number | null;
  sub_subcategory_id: number | null;
  brand_id: number | null;
  lifestyle_tag_id: number | null;
  sort: string;
  search: string;
};

const BASE_FIELDS = `
  id, name, lifestyle_tag_id, category_id, subcategory_id, sub_subcategory_id, brand_id, created_at,
  product_images(image_url)`;
const VARIATION_FIELDS = "id, price, stock, size_id, attributes:size_id(name)";
const IN_STOCK_SELECT = `${BASE_FIELDS}, product_variations!inner(${VARIATION_FIELDS})`;
// `instock` is a second embed of the variations, filtered to stock > 0; "instock is null" keeps
// only products where no variation is in stock.
const SOLD_OUT_SELECT = `${BASE_FIELDS}, product_variations(${VARIATION_FIELDS}), instock:product_variations(id)`;

const mapProducts = (rows: any[]) =>
  rows.map((p) => ({
    ...p,
    price: p.product_variations?.[0]?.price || 0,
    image: p.product_images?.[0]?.image_url,
  }));

function applyFilters(query: any, f: GalleryFilters) {
  let q = query.eq("active", true);
  if (f.category_id) q = q.eq("category_id", f.category_id);
  if (f.subcategory_id) q = q.eq("subcategory_id", f.subcategory_id);
  if (f.sub_subcategory_id) q = q.eq("sub_subcategory_id", f.sub_subcategory_id);
  if (f.brand_id) q = q.eq("brand_id", f.brand_id);
  if (f.lifestyle_tag_id) q = q.eq("lifestyle_tag_id", f.lifestyle_tag_id);
  if (f.search) q = q.ilike("name", `%${f.search}%`);
  return q;
}

const inStock = (select: string, f: GalleryFilters, options?: any) =>
  applyFilters(supabase.from("products").select(select, options), f).gt("product_variations.stock", 0);

const soldOut = (select: string, f: GalleryFilters, options?: any) =>
  applyFilters(supabase.from("products").select(select, options), f).gt("instock.stock", 0).is("instock", null);

function applyOrder(query: any, sort: string) {
  if (sort === "alpha") return query.order("name", { ascending: true });
  if (sort === "oldest") return query.order("created_at", { ascending: true });
  return query.order("created_at", { ascending: false });
}

function unwrap<T>({ data, error }: { data: T | null; error: any }): T {
  if (error) throw error;
  return data as T;
}

export async function fetchGalleryPage(f: GalleryFilters, page: number) {
  const from = (page - 1) * PRODUCTS_PER_PAGE;
  const to = from + PRODUCTS_PER_PAGE - 1;

  if (f.sort === "price_asc" || f.sort === "price_desc") {
    const [inRows, outRows] = await Promise.all([
      inStock("id, product_variations!inner(price)", f).then(unwrap<any[]>),
      soldOut("id, product_variations(price), instock:product_variations(id)", f).then(unwrap<any[]>),
    ]);
    const byPrice = (rows: any[]) =>
      rows
        .map((p) => ({ id: p.id, price: p.product_variations?.[0]?.price ?? 0 }))
        .sort((a, b) => (f.sort === "price_asc" ? a.price - b.price : b.price - a.price))
        .map((p) => p.id);
    const inIds = byPrice(inRows || []);
    const outIds = byPrice(outRows || []);
    const pageIds = [...inIds, ...outIds].slice(from, to + 1);
    const pageIn = pageIds.filter((id) => inIds.includes(id));
    const pageOut = pageIds.filter((id) => outIds.includes(id));

    const [fullIn, fullOut] = await Promise.all([
      pageIn.length ? inStock(IN_STOCK_SELECT, f).in("id", pageIn).then(unwrap<any[]>) : [],
      pageOut.length ? soldOut(SOLD_OUT_SELECT, f).in("id", pageOut).then(unwrap<any[]>) : [],
    ]);
    const rows = [...(fullIn || []), ...(fullOut || [])];
    return {
      products: mapProducts(pageIds.map((id) => rows.find((r) => r.id === id)).filter(Boolean)),
      count: inIds.length + outIds.length,
    };
  }

  // Counts first, so each group is only asked for rows it has.
  const [inHead, outHead] = await Promise.all([
    inStock("id, product_variations!inner(id)", f, { count: "exact", head: true }),
    soldOut("id, instock:product_variations(id)", f, { count: "exact", head: true }),
  ]);
  if (inHead.error) throw inHead.error;
  if (outHead.error) throw outHead.error;
  const inCount = inHead.count || 0;
  const outCount = outHead.count || 0;

  const outFrom = Math.max(0, from - inCount);
  const outTo = Math.min(to - inCount, outCount - 1);
  const [inPage, outPage] = await Promise.all([
    from < inCount
      ? applyOrder(inStock(IN_STOCK_SELECT, f), f.sort).range(from, Math.min(to, inCount - 1)).then(unwrap<any[]>)
      : [],
    outFrom <= outTo
      ? applyOrder(soldOut(SOLD_OUT_SELECT, f), f.sort).range(outFrom, outTo).then(unwrap<any[]>)
      : [],
  ]);

  return { products: mapProducts([...(inPage || []), ...(outPage || [])]), count: inCount + outCount };
}
