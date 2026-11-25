"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import {
  exchangeRecoveryCode,
  requestPasswordReset,
  resendLogin2FA,
  signIn,
  supabaseConfigured,
  updatePassword,
  verifyLogin2FA,
} from "../../lib/supabase";
import { routeFor } from "../../admin/navigation";
import { Checkbox } from "@/components/ui/checkbox";

export function LoginForm({ recovery = false }: { recovery?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [twoFA, setTwoFA] = useState<{
    email: string;
    password: string;
    tempToken: string;
    maskedPhone: string;
  } | null>(null);
  const [code2FA, setCode2FA] = useState("");

  useEffect(() => {
    if (!recovery) return;
    void exchangeRecoveryCode()
      .then((session) => setRecovering(Boolean(session)))
      .catch((reason: Error) => setError(reason.message));
  }, [recovery]);

  function redirectToPanel() {
    setEntering(true);
    setTimeout(() => {
      window.location.assign(routeFor(""));
    }, 420);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim().toLowerCase();
    const password = String(values.get("password") ?? "");

    try {
      if (recovery && recovering) {
        await updatePassword(password);
        setMessage("Senha atualizada com sucesso. Redirecionando para o login…");
        setTimeout(() => window.location.assign(routeFor("login")), 1200);
      } else if (recovery) {
        await requestPasswordReset(email);
        setMessage("Se o e-mail estiver cadastrado, enviaremos um link de recuperação.");
      } else if (twoFA) {
        await verifyLogin2FA({
          email: twoFA.email,
          password: twoFA.password,
          tempToken: twoFA.tempToken,
          code: code2FA,
        });
        redirectToPanel();
      } else {
        const result = await signIn(email, password);
        if (result.requires2FA && result.tempToken) {
          setTwoFA({
            email,
            password,
            tempToken: result.tempToken,
            maskedPhone: result.maskedPhone || "****",
          });
          setMessage(`Enviamos um código de 6 dígitos para o WhatsApp ${result.maskedPhone || "****"}.`);
          return;
        }
        redirectToPanel();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`admin-login-page${entering ? " is-entering" : ""}`}>
      {entering && (
        <div className="admin-login-transition" aria-live="polite">
          <div className="admin-login-transition-card">
            <div className="admin-login-icon admin-login-transition-logo">
              <img src="/benittes-logo.png" alt="Benittes Oficina Mecânica" />
            </div>
            <span>Entrando no painel…</span>
          </div>
        </div>
      )}
      <a href="/" className="admin-back">
        <ArrowLeft size={16} /> Voltar ao site
      </a>
      <div className="admin-login-brand">BN</div>

      <form className={`admin-login-form${entering ? " is-leaving" : ""}`} onSubmit={handleSubmit}>
        <div className="admin-login-icon">
          <img src="/benittes-logo.png" alt="Benittes Oficina Mecânica" />
        </div>

        <div>
          <h1>
            {recovery
              ? recovering
                ? "Nova senha"
                : "Recuperar acesso"
              : "Entrar no painel"}
          </h1>
          {recovery && (
            <p className="admin-login-sub">
              {recovering
                ? "Crie uma nova senha para acessar o painel."
                : "Informe seu e-mail para receber o link de redefinição."}
            </p>
          )}
        </div>

        {!supabaseConfigured && (
          <p className="admin-form-error">
            Configure PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_PUBLISHABLE_KEY no ambiente para habilitar o login.
          </p>
        )}

        {twoFA ? (
          <>
            <label className="admin-field">
              <span>Código de verificação (WhatsApp {twoFA.maskedPhone})</span>
              <input
                className="admin-input"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code2FA}
                onChange={(e) => setCode2FA(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
              />
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <button
                type="button"
                className="admin-link"
                onClick={() => {
                  setTwoFA(null);
                  setCode2FA("");
                  setError("");
                  setMessage("");
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                className="admin-link"
                onClick={() => {
                  setError("");
                  void resendLogin2FA(twoFA.email, twoFA.tempToken)
                    .then(() => setMessage("Novo código enviado via WhatsApp."))
                    .catch((err: Error) => setError(err.message));
                }}
              >
                Reenviar código
              </button>
            </div>
          </>
        ) : (!recovery || !recovering) && (
          <label className="admin-field">
            <span>E-mail</span>
            <input
              className="admin-input"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nome@benittes.com.br"
              maxLength={254}
              required
            />
          </label>
        )}

        {!recovery && !twoFA && (
          <label className="admin-field">
            <span>Senha</span>
            <div className="admin-password-wrap">
              <input
                className="admin-input"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Sua senha de acesso"
                required
              />
              <button
                type="button"
                className="admin-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
        )}

        {recovery && recovering && (
          <label className="admin-field">
            <span>Nova senha</span>
            <input
              className="admin-input"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              placeholder="Mínimo de 12 caracteres"
              required
            />
            <small>Use pelo menos 12 caracteres.</small>
          </label>
        )}

        {!recovery && !twoFA && (
          <div className="admin-login-row">
            <label className="admin-check">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <span>Manter conectado</span>
            </label>
            <a className="admin-link-muted" href={routeFor("recuperar-senha")}>
              Esqueci minha senha
            </a>
          </div>
        )}

        {error && (
          <p className="admin-form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="admin-form-success" role="status">
            {message}
          </p>
        )}

        <button className="admin-primary" style={{ width: "100%", height: 44 }} disabled={loading || !supabaseConfigured}>
          {loading
            ? "Aguarde…"
            : recovery
              ? recovering
                ? "Salvar nova senha"
                : "Enviar link de acesso"
              : "Entrar no painel"}
          <ArrowRight size={16} />
        </button>

        {recovery && (
          <a className="admin-link-muted" href={routeFor("login")} style={{ textAlign: "center" }}>
            Voltar para o login
          </a>
        )}
      </form>
    </main>
  );
}
