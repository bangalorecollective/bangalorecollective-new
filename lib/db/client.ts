// Drop-in replacement for the parts of @supabase/supabase-js this site uses, talking only to this
// site's own server. Pages keep their queries unchanged:
//
//   supabase.from(table)...   PostgREST query builder, through /api/rest (row level security applies)
//   supabase.rpc(fn, args)    database functions, same route
//   supabase.auth.*           customer sign-in, /api/auth/customer/*
//   supabase.storage.from()   uploads on the VPS, /api/storage/*
//   supabase.channel()        no-op (the only realtime listener never received events on Supabase)
//
// createClient() ignores its arguments, so existing `createClient(url, key)` calls keep compiling.
import { PostgrestClient } from "@supabase/postgrest-js";

type AnyRecord = Record<string, any>;
type AuthError = { message: string; status?: number };
type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED" | "PASSWORD_RECOVERY";
type Session = { user: AnyRecord; expires_at: number } | null;
type Listener = (event: AuthEvent, session: Session) => void;

const isBrowser = typeof window !== "undefined";

// Storefront pages; everything else is the admin panel (same split as app/ClientLayout.tsx).
// "/product/" keeps its slash so the admin "/productreport" page is not mistaken for it.
const STOREFRONT_PREFIXES = ["/userinterface", "/product/", "/category", "/login", "/reset-password"];
function appArea() {
  if (!isBrowser) return "storefront";
  const p = window.location.pathname;
  return p === "/" || STOREFRONT_PREFIXES.some((prefix) => p.startsWith(prefix)) ? "storefront" : "admin";
}

const browserFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("x-app-area", appArea());
  return fetch(input, { ...init, headers, credentials: "same-origin" });
};

async function postJson(url: string, body: unknown) {
  const res = await browserFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// ---------------------------------------------------------------- auth

const listeners = new Set<Listener>();
let cachedSession: Promise<Session> | null = null;
const authChannel = isBrowser && "BroadcastChannel" in window ? new BroadcastChannel("bc-auth") : null;

function emit(event: AuthEvent, session: Session, fromOtherTab = false) {
  cachedSession = Promise.resolve(session);
  listeners.forEach((l) => l(event, session));
  if (!fromOtherTab) authChannel?.postMessage({ event, session });
}
authChannel?.addEventListener("message", (e) => emit(e.data.event, e.data.session, true));

// A password-reset email links to the update-password page with ?reset_token=...; trade it for
// a session before anything asks for one, the way Supabase signed in from its recovery link.
let recovery: Promise<void> | null = null;
function exchangeResetToken() {
  if (!isBrowser || recovery) return recovery;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("reset_token");
  if (!token) return null;
  url.searchParams.delete("reset_token");
  window.history.replaceState(null, "", url.toString());
  recovery = postJson("/api/auth/customer/recover", { token }).then(({ ok, json }) => {
    if (ok) emit("PASSWORD_RECOVERY", json.session);
  });
  return recovery;
}

function loadSession(): Promise<Session> {
  if (!isBrowser) return Promise.resolve(null);
  if (!cachedSession) {
    cachedSession = (async () => {
      await exchangeResetToken();
      const res = await browserFetch("/api/auth/customer/session", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      return (json.session as Session) ?? null;
    })();
    // Re-check now and then, in case the session ended on the server.
    setTimeout(() => (cachedSession = null), 60_000);
  }
  return cachedSession;
}

const authError = (json: AnyRecord): AuthError => ({
  message: json.error?.message ?? "Something went wrong. Please try again.",
  status: json.error?.status,
});

const auth = {
  async getSession() {
    return { data: { session: await loadSession() }, error: null };
  },

  async getUser() {
    const session = await loadSession();
    return session
      ? { data: { user: session.user }, error: null }
      : { data: { user: null }, error: { message: "Auth session missing!", status: 400 } as AuthError };
  },

  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    loadSession().then((session) => listeners.has(callback) && callback("INITIAL_SESSION", session));
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            listeners.delete(callback);
          },
        },
      },
    };
  },

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const { ok, json } = await postJson("/api/auth/customer/login", { email, password });
    if (!ok) return { data: { user: null, session: null }, error: authError(json) };
    emit("SIGNED_IN", json.session);
    return { data: { user: json.user, session: json.session }, error: null };
  },

  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: AnyRecord } }) {
    const { ok, json } = await postJson("/api/auth/customer/signup", { email, password, data: options?.data });
    if (!ok) return { data: { user: null, session: null }, error: authError(json) };
    return { data: { user: json.user, session: null }, error: null };
  },

  async signOut() {
    await postJson("/api/auth/customer/logout", {});
    emit("SIGNED_OUT", null);
    return { error: null };
  },

  // The link always points at this site's update-password page; options.redirectTo is ignored so
  // emails can never send customers to another domain.
  async resetPasswordForEmail(email: string, _options?: { redirectTo?: string }) {
    const { ok, json } = await postJson("/api/auth/customer/recover-request", { email });
    return ok ? { data: {}, error: null } : { data: null, error: authError(json) };
  },

  async updateUser({ password }: { password?: string }) {
    const { ok, json } = await postJson("/api/auth/customer/update", { password });
    if (!ok) return { data: { user: null }, error: authError(json) };
    emit("USER_UPDATED", json.session);
    return { data: { user: json.user }, error: null };
  },
};

// ---------------------------------------------------------------- storage

function storageBucket(bucket: string) {
  return {
    async upload(
      path: string,
      file: Blob | ArrayBuffer,
      options: { upsert?: boolean; contentType?: string; cacheControl?: string } = {}
    ) {
      const form = new FormData();
      const blob = file instanceof Blob ? file : new Blob([file], { type: options.contentType });
      form.append("file", blob, (file as File).name ?? path.split("/").pop());
      form.append("bucket", bucket);
      form.append("path", path);
      form.append("upsert", String(Boolean(options.upsert)));
      const res = await browserFetch("/api/storage/upload", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      return res.ok ? { data: json.data, error: null } : { data: null, error: json.error ?? { message: "Upload failed" } };
    },

    // Relative, like the links already in the database (deploy/sql/030_storage_links.sql), so a
    // saved link works on any address the site runs at.
    getPublicUrl(path: string) {
      const encoded = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
      return { data: { publicUrl: `/storage/v1/object/public/${bucket}/${encoded}` } };
    },

    async remove(paths: string[]) {
      const { ok, json } = await postJson("/api/storage/remove", { bucket, paths });
      return ok ? { data: json.data, error: null } : { data: null, error: json.error ?? { message: "Delete failed" } };
    },
  };
}

// ---------------------------------------------------------------- client

function createDbClient() {
  // In the browser every query goes through /api/rest; server components call PostgREST directly
  // as a visitor (anon), which is all they need for storefront content. Plain fetch on the server,
  // as supabase-js used, so pages keep their own caching (e.g. the home page's revalidate = 300).
  const rest = isBrowser
    ? new PostgrestClient<any>(`${window.location.origin}/api/rest`, { fetch: browserFetch })
    : new PostgrestClient<any>(process.env.POSTGREST_URL ?? "");

  const channel = {
    on(..._args: unknown[]) {
      return channel;
    },
    subscribe(callback?: (status: string) => void) {
      callback?.("SUBSCRIBED");
      return channel;
    },
    unsubscribe() {
      return Promise.resolve("ok");
    },
  };

  return {
    from: (table: string) => rest.from(table),
    rpc: (fn: string, args?: AnyRecord, options?: AnyRecord) => rest.rpc(fn, args, options),
    auth,
    storage: { from: storageBucket },
    channel: (_name: string) => channel,
    removeChannel: (_channel: unknown) => Promise.resolve("ok"),
  };
}

let shared: ReturnType<typeof createDbClient> | null = null;

export function createClient(..._ignored: unknown[]) {
  if (!isBrowser) return createDbClient();
  shared ??= createDbClient();
  return shared;
}

export type DbClient = ReturnType<typeof createDbClient>;
export type { Session };
export default createClient;
