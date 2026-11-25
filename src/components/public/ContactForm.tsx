"use client";

import { useState, type FormEvent } from "react";

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 1500;

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const website = String(fields.get("website") || "").trim();

    if (website) {
      setName("");
      setEmail("");
      setMessage("");
      setStatus("Mensagem enviada. A equipe entrará em contato em breve.");
      return;
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanMessage = message.trim();

    if (cleanName.length < 2 || cleanName.length > NAME_MAX) {
      setStatus(`Informe seu nome (entre 2 e ${NAME_MAX} caracteres).`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setStatus("Informe um e-mail válido.");
      return;
    }
    if (cleanMessage.length < MESSAGE_MIN || cleanMessage.length > MESSAGE_MAX) {
      setStatus(`A mensagem deve ter entre ${MESSAGE_MIN} e ${MESSAGE_MAX} caracteres.`);
      return;
    }

    setSending(true);
    setStatus("Enviando…");

    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          message: cleanMessage,
          website,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || "Não foi possível enviar sua mensagem agora.");
      }
      setName("");
      setEmail("");
      setMessage("");
      setStatus("Mensagem enviada. A equipe entrará em contato em breve.");
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "Não foi possível enviar sua mensagem agora. Tente novamente em alguns minutos.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="form-grid">
        <label>
          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Seu nome</span>
            <small style={{ opacity: 0.65, fontSize: 11 }}>{name.length}/{NAME_MAX}</small>
          </span>
          <input
            name="name"
            autoComplete="name"
            minLength={2}
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          <span>Seu e-mail</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={EMAIL_MAX}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
      </div>
      <label>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Mensagem</span>
          <small style={{ opacity: 0.65, fontSize: 11 }}>
            {message.length}/{MESSAGE_MAX} (mín. {MESSAGE_MIN})
          </small>
        </span>
        <textarea
          name="message"
          rows={5}
          minLength={MESSAGE_MIN}
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
      </label>
      <label
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}
      >
        <span>Deixe este campo vazio</span>
        <input name="website" autoComplete="off" tabIndex={-1} />
      </label>
      <div className="form-actions">
        <button className="btn blue" type="submit" disabled={sending}>
          Enviar mensagem
        </button>
        <p aria-live="polite">{status}</p>
      </div>
    </form>
  );
}
