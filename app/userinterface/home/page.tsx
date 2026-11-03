import supabase from "@/lib/supabase";
import { unstable_cache } from "next/cache";
import HomeClient from "@/app/userinterface/home/HomeClient";

// Rendered on request, not at build time: Coolify builds the site without database access.
export const dynamic = "force-dynamic";

// The home page data is shared for five minutes, so catalog and promotional changes can take up
// to five minutes to appear here. A failed query throws, so an empty page is never cached.
const getHomeData = unstable_cache(
  async () => {
    const results = await Promise.all([
      supabase.from("attributes").select("id, type, name").eq("type", "lifestyle_tag"),
      supabase.from("hero_section").select("*").eq("active", true).order("created_at", { ascending: false }),
      supabase
        .from("site_info")
        .select(`
          middle_badge, middle_title, middle_description,
          cat1_title, cat1_description, cat1_image_url,
          cat2_title, cat2_description, cat2_image_url,
          cat3_title, cat3_description, cat3_image_url,
          live_badge, live_title, live_image_url, live_quote,
          stat1_value, stat1_label, stat2_value, stat2_label,
          stat3_value, stat3_label, stat4_value, stat4_label
        `)
        .eq("id", 1)
        .single(),
      supabase.from("categories").select("*").eq("home_status", true).order("priority", { ascending: true }),
      supabase.from("subcategories").select("*").order("priority", { ascending: true }),
      supabase.from("brands").select("*").eq("status", true).order("id", { ascending: false }),
      supabase.from("instagram_links").select("url").eq("published", true).order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select(`*, product_variations(*, attributes:size_id(name)), product_images(image_url)`)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("products")
        .select(`*, product_variations(*, attributes:size_id(name)), product_images(image_url)`)
        .not("lifestyle_tag_id", "is", null)
        .eq("active", true)
        .limit(40),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
    return results.map((r) => r.data);
  },
  ["home-page-data"],
  { revalidate: 300 }
);

export default async function HomePage() {
  try {
    const [
      attributesData,
      heroSections,
      siteInfo,
      categoriesData,
      subcategoriesData,
      brandsData,
      instagramData,
      productsData,
      lifestyleProductsData,
    ]: any[] = await getHomeData();

    const tagsData = attributesData || [];

    // --- Spotlight products: in-stock only, capped at 6 ---
    const latestProducts = (productsData || [])
      .filter((p: any) => p.product_variations?.some((v: any) => v.stock > 0))
      .slice(0, 6)
      .map((p: any) => ({
        ...p,
        price: p.product_variations?.[0]?.price || 0,
        image: p.product_images?.[0]?.image_url,
        availableSizes: Array.from(
          new Set(p.product_variations?.map((v: any) => v.attributes?.name).filter(Boolean))
        ),
      }));

    // --- Lifestyle sections ---
    const lifestyleSections = tagsData
      .map((tag: any) => {
        const products = (lifestyleProductsData || [])
          .filter((p: any) => p.lifestyle_tag_id === tag.id)
          .slice(0, 4)
          .map((p: any) => ({
            ...p,
            price: p.product_variations?.[0]?.price || 0,
            image: p.product_images?.[0]?.image_url,
            availableSizes: Array.from(
              new Set(p.product_variations?.map((v: any) => v.attributes?.name).filter(Boolean))
            ),
          }));
        return { tagId: tag.id, tagName: tag.name, products };
      })
      .filter((s: any) => s.products.length > 0);

    return (
      <HomeClient
        initialHeroSections={heroSections || []}
        initialData={siteInfo || null}
        initialCategories={categoriesData || []}
        initialSubcategories={subcategoriesData || []}
        initialBrands={brandsData || []}
        initialLatestProducts={latestProducts}
        initialLifestyleSections={lifestyleSections}
        initialInstagramLinks={instagramData || []}
        initialAttributes={attributesData || []}
      />
    );
  } catch (error) {
    console.error("Error loading home page data:", error);
    return (
      <HomeClient
        initialHeroSections={[]}
        initialData={null}
        initialCategories={[]}
        initialSubcategories={[]}
        initialBrands={[]}
        initialLatestProducts={[]}
        initialLifestyleSections={[]}
        initialInstagramLinks={[]}
        initialAttributes={[]}
      />
    );
  }
}