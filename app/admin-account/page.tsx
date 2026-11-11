"use client";

// The main admin changes its own login email and/or password. The current password is always
// needed. Staff (subadmin) logins are managed on the Admin Creations page instead.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Eye, EyeOff, Key, Loader2, Lock, Mail, UserCog } from "lucide-react";

const MIN_PASSWORD_LENGTH = 12;

export default function AdminAccount() {
  const [loadedEmail, setLoadedEmail] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/admin/account", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 403) return setForbidden(true);
        const json = await res.json();
        setLoadedEmail(json.email ?? "");
        setEmail(json.email ?? "");
      })
      .catch(() => toast.error("Could not load the admin account"))
      .finally(() => setFetching(false));
  }, []);

  const save = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!currentPassword) return toast.error("Enter your current password");
    if (!cleanEmail) return toast.error("Enter the admin email");
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      return toast.error(`New password should be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (newPassword !== confirmPassword) return toast.error("New passwords do not match");
    if (cleanEmail === loadedEmail && !newPassword) return toast.error("Nothing to change");

    setSaving(true);
    try {
      const res = await fetch("/api/auth/admin/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, email: cleanEmail, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || "Could not save the changes");

      setLoadedEmail(json.email);
      setEmail(json.email);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Admin login updated. Other devices have been signed out.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const passwordInput = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    autoComplete: string
  ) => (
    <div className="space-y-3">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">{label}</label>
      <div className="relative group">
        <Key className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#c4a174] transition-colors" size={18} />
        <input
          type={showPasswords ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          className="w-full h-16 pl-16 pr-6 bg-slate-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-[#c4a174] outline-none transition font-black text-xs"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FBFBFC] text-[#2b2652] font-sans selection:bg-[#c4a174] selection:text-white p-6 md:p-10">
      {/* Header */}
      <div className="max-w-2xl mx-auto mb-12 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#2b2652] flex items-center justify-center shadow-lg shadow-[#2b2652]/20">
            <UserCog className="text-[#c4a174] w-5 h-5" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Main Admin Only</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter uppercase leading-none">
          Admin <span className="text-[#c4a174] italic">Account</span>
        </h1>
        <p className="text-xs text-slate-400 font-bold">
          Change the main admin login email and password. Your current password is needed to save.
        </p>
      </div>

      <div className="max-w-2xl mx-auto bg-white rounded-[2.5rem] shadow-2xl shadow-[#2b2652]/5 border border-slate-100 overflow-hidden">
        {fetching ? (
          <div className="py-20">
            <Loader2 className="w-8 h-8 text-[#c4a174] animate-spin mx-auto" />
          </div>
        ) : forbidden ? (
          <div className="py-20 px-10 text-center text-slate-400 font-black text-[11px] uppercase tracking-widest">
            Only the main admin can open this page.
          </div>
        ) : (
          <>
            <div className="p-6 md:p-10 space-y-8">
              {/* Email */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Admin Login Email</label>
                <div className="relative group">
                  <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#c4a174] transition-colors" size={18} />
                  <input
                    type="email"
                    value={email}
                    autoComplete="username"
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-16 pl-16 pr-6 bg-slate-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-[#c4a174] outline-none transition font-black text-xs tracking-widest"
                  />
                </div>
              </div>

              {passwordInput("New Password (leave empty to keep the current one)", newPassword, setNewPassword, "new-password")}
              {passwordInput("Confirm New Password", confirmPassword, setConfirmPassword, "new-password")}

              <div className="pt-8 border-t border-slate-100 space-y-8">
                <div className="flex items-center gap-2 text-[10px] font-black text-[#c4a174] uppercase tracking-widest">
                  <Lock size={14} /> Confirm it's you
                </div>
                {passwordInput("Current Password", currentPassword, setCurrentPassword, "current-password")}
              </div>

              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#2b2652] transition-colors ml-2"
              >
                {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                {showPasswords ? "Hide passwords" : "Show passwords"}
              </button>
            </div>

            <div className="p-6 md:p-10 bg-slate-50/50 border-t border-slate-100">
              <button
                onClick={save}
                disabled={saving}
                className="w-full h-16 bg-[#2b2652] text-[#c4a174] rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-[#c4a174] hover:text-[#2b2652] shadow-xl shadow-[#2b2652]/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save Changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
