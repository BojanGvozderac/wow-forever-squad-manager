import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Swords, ShieldCheck, ArrowRight, KeyRound } from "lucide-react";
import { login } from "../server/api";
import { Button, ErrorNotice, Field, message } from "../components/app";
export const Route = createFileRoute("/login")({ component: Login });
function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <main className="login-page">
      <div className="login-art" aria-hidden="true">
        <div className="login-rune">
          <Swords size={92} />
        </div>
        <h1>WoW Forever</h1>
        <div className="login-art-footer">
          WOW FOREVER <span>✦</span> WORLDWIDE
        </div>
      </div>
      <div className="login-panel">
        <a href="/" className="brand">
          <div className="brand-mark">
            <Swords size={24} />
          </div>
          <span>
            WOW FOREVER<small>THE WAR ROOM</small>
          </span>
        </a>
        <div className="login-form">
          <h2>Sign in</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await login({
                  data: {
                    username: String(f.get("username")),
                    key: String(f.get("key")),
                  },
                });
                await navigate({ to: "/" });
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Username">
              <input
                name="username"
                autoComplete="username"
                required
                placeholder="Username"
              />
            </Field>
            <Field label="Login key">
              <div className="input-icon">
                <KeyRound size={16} />
                <input
                  name="key"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="Enter your personal key"
                />
              </div>
            </Field>
            <ErrorNotice error={error} />
            <Button className="full-width" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="login-help">
            <ShieldCheck size={17} />
            <p>
              This is a private squad space. Ask your administrator for your
              username and personal login key.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
