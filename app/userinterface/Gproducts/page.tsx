import supabase from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import ProductsClient from "./ProductsClient";
import { fetchGalleryPage } from "./galleryQuery";

// Force fresh data per request since filters/pagination come from the URL.
export const dynamic = "force-dynamic";

// --- Static filter chrome: cached independently of product data, revalidated hourly. ---
// These rarely change, so there's no reason to hit the DB for them on every request.
const getFilterChrome = unstable_cache(
  async () => {
    const [{ data: brands }, { data: categories }, { data: lifestyleTags }] = await Promise.all([
      supabase.from("brands").select("*").eq("status", true),
      supabase
        .from("categories")
        .select(`id, name, subcategories (id, name, sub_subcategories (id, name))`)
        .order("priority", { ascending: true }),
      supabase.from("attributes").select("id, name").eq("type", "lifestyle_tag"),
    ]);
    return {
      brands: brands || [],
      categories: categories || [],
      lifestyleTags: lifestyleTags || [],
    };
  },
  ["products-filter-chrome"],
  { revalidate: 3600 } // Brands, categories and tags can take up to an hour to update.
);

async function fetchProducts({
  categoryId,
  brandId,
  lifestyleTagId,
  page,
}: {
  categoryId: number | null;
  brandId: number | null;
  lifestyleTagId: number | null;
  page: number;
}) {
  try {
    return await fetchGalleryPage(
      {
        category_id: categoryId,
        subcategory_id: null,
        sub_subcategory_id: null,
        brand_id: brandId,
        lifestyle_tag_id: lifestyleTagId,
        sort: "latest",
        search: "",
      },
      page
    );
  } catch (err) {
    console.error("Failed to load gallery products:", err);
    return { products: [], count: 0 };
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const categoryId = params.category_id ? Number(params.category_id) : null;
  const brandId = params.brand_id ? Number(params.brand_id) : null;
  const tagParam = typeof params.tag === "string" ? params.tag : null;
  const page = params.page ? Number(params.page) : 1;

  // Chrome data is cached, so this resolves near-instantly on warm cache.
  const chromePromise = getFilterChrome();

  let brands, categories, lifestyleTags, initialProducts, count, resolvedTagId: number | null;

  if (tagParam) {
    // Tag needs to be resolved to an id before we can filter products —
    // this is the only case that has to be sequential.
    const chrome = await chromePromise;
    brands = chrome.brands;
    categories = chrome.categories;
    lifestyleTags = chrome.lifestyleTags;
    resolvedTagId =
      lifestyleTags.find((t: any) => t.name.toLowerCase() === tagParam.toLowerCase())?.id ?? null;

    const result = await fetchProducts({ categoryId, brandId, lifestyleTagId: resolvedTagId, page });
    initialProducts = result.products;
    count = result.count;
  } else {
    // No tag param: chrome and products don't depend on each other — run in parallel.
    resolvedTagId = null;
    const [chrome, result] = await Promise.all([
      chromePromise,
      fetchProducts({ categoryId, brandId, lifestyleTagId: null, page }),
    ]);
    brands = chrome.brands;
    categories = chrome.categories;
    lifestyleTags = chrome.lifestyleTags;
    initialProducts = result.products;
    count = result.count;
  }

  return (
    <ProductsClient
      initialProducts={initialProducts}
      initialTotalCount={count}
      initialBrands={brands}
      initialCategories={categories}
      initialLifestyleTags={lifestyleTags}
      initialFilters={{
        category_id: categoryId,
        brand_id: brandId,
        lifestyle_tag_id: resolvedTagId,
      }}
      initialPage={page}
    />
  );
}