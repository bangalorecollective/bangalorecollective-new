import { createClient } from "@/lib/db/client";

// Same name as before so existing imports keep working; it now talks only to this site's server.
const supabase = createClient();

export default supabase;
