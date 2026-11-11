import React, { useState } from 'react';
import { Shield, Mail, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { useSecurityStore } from '../store';

export const LoginScreen: React.FC = () => {
  const { login, isAuthenticating, authError } = useSecurityStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await login(email.trim(), password);
    } catch {
      // authError wird im Store gesetzt und unten angezeigt.
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1d] text-slate-100 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">SecurityOps 2.0</h1>
            <p className="text-[11px] text-slate-400">Anmeldung an der PostgreSQL-Instanz</p>
          </div>
        </div>

        {authError && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">E-Mail</span>
          <div className="flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 focus-within:border-blue-500">
            <Mail className="w-4 h-4 text-slate-500" />
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              placeholder="name@unternehmen.de"
            />
          </div>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Passwort</span>
          <div className="flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 focus-within:border-blue-500">
            <Lock className="w-4 h-4 text-slate-500" />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              placeholder="••••••••"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={isAuthenticating}
          className="w-full px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition flex items-center justify-center gap-2"
        >
          {isAuthenticating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Anmeldung läuft…</span>
            </>
          ) : (
            <span>Anmelden</span>
          )}
        </button>

        <p className="text-[10px] text-slate-500 leading-relaxed">
          Die Anmeldung erfolgt gegen das SecurityOps-Backend. Ohne gültige Sitzung werden keine
          Mandantendaten geladen.
        </p>
      </form>
    </div>
  );
};
