"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <span className="w-10 h-10 rounded-xl bg-accent-strong text-ink-950 grid place-items-center font-black text-lg">
            M
          </span>
          <div>
            <div className="font-bold text-ink-100 text-lg leading-tight">Miya Pipeline</div>
            <div className="text-xs text-ink-400">Automation control center</div>
          </div>
        </div>
        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@miyagroupbd.com"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div className="text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
