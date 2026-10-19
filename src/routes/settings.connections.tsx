import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { createMcpToken, listMcpTokens, revokeMcpToken, type McpScope } from "../server/mcp-token-api";
import { Button, ErrorNotice, Field, Loading, Modal, PageHeading, message, useData } from "../components/app";

export const Route = createFileRoute("/settings/connections")({ component: Connections });
const scopeLabels: Record<McpScope, string> = {
  read: "Read squads, characters, wishlists, and calendars",
  "wishlist:write": "Edit my characters’ wishlists",
  "availability:write": "Manage my availability",
};
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString();

function Connections() {
  const { data: tokens, loading, error: loadError, reload } = useData(() => listMcpTokens());
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  useEffect(() => { setServerUrl(`${window.location.origin}/mcp`); }, []);
  const close = () => {
    if (busy) return;
    setOpen(false); setSecret(null); setVisible(false); setError(""); setNotice("");
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Copy failed. Select the field and copy it manually."); }
  };
  return <>
    <PageHeading title="AI connections" action={<Button onClick={() => { setError(""); setNotice(""); setOpen(true); }}><Plus size={17} /> Create token</Button>}>
      Connect an AI assistant to your squads. Each connection has its own permissions and expiry.
    </PageHeading>
    <section className="connection-setup">
      <h2>Connect your assistant</h2>
      <p>Create a token, then add this server in a client that supports MCP over HTTP with a bearer token. Enter the token in its connection settings, never in a chat message.</p>
      <Field label="MCP server URL"><input readOnly value={serverUrl} onFocus={(event) => event.target.select()} /></Field>
      <button className="secondary-button" onClick={() => void copy(serverUrl)}>Copy server URL</button>
      <details>
        <summary>Codex CLI setup</summary>
        <p>Add this to your Codex configuration. Set <code>WAR_ROOM_MCP_TOKEN</code> in the environment used to launch Codex, using your generated token.</p>
        <pre>{`[mcp_servers.war_room]\nurl = "${serverUrl}"\nbearer_token_env_var = "WAR_ROOM_MCP_TOKEN"`}</pre>
        <p>Restart the client after configuring it. This connection uses a personal token; OAuth sign-in is not required. <a href="https://developers.openai.com/codex/mcp" target="_blank" rel="noreferrer">Codex setup documentation</a></p>
      </details>
    </section>
    <ErrorNotice error={loadError || (!open ? error : "")} />
    {!open && <p role="status">{notice}</p>}
    <section className="connections-list">
      <h2>Your tokens</h2>
      <p>Tokens can only act within your account’s permissions. Revocation takes effect on subsequent requests. Signing out of the website keeps these connections active.</p>
      {loading ? <Loading /> : !tokens?.length ? <p className="muted">No connections yet.</p> : tokens.map((token) => {
        const expired = token.expiresAt * 1000 <= Date.now();
        const inactive = token.revokedAt !== null || expired;
        return <article className="connection-card" key={token.id}>
          <div className="connection-card-heading"><h3><KeyRound size={17} /> {token.name}</h3><span>{token.revokedAt !== null ? "Revoked" : expired ? "Expired" : "Active"}</span></div>
          <ul>{token.scopes.map((scope) => <li key={scope}>{scopeLabels[scope]}</li>)}</ul>
          <p className="muted">Created {date(token.createdAt)} · Expires {date(token.expiresAt)}</p>
          <p className="muted">Last used: {token.lastUsedAt ? date(token.lastUsedAt) : "Never"}</p>
          {!inactive && <button className="danger-button" disabled={busy} onClick={async () => {
            setBusy(true); setError(""); setNotice("");
            try { await revokeMcpToken({ data: { id: token.id } }); await reload(); setNotice(`Revoked ${token.name}.`); }
            catch (error) { setError(message(error)); }
            finally { setBusy(false); }
          }}>Revoke {token.name}</button>}
        </article>;
      })}
    </section>
    {open && <Modal title={secret ? "Token created" : "Create AI connection token"} onClose={close}>
      {secret ? <>
        <p>Save this token now. It cannot be retrieved after closing this dialog.</p>
        <Field label="Generated MCP token"><input readOnly type={visible ? "text" : "password"} value={secret} autoComplete="off" spellCheck={false} onFocus={(event) => event.target.select()} /></Field>
        <div className="connection-token-actions">
          <button className="secondary-button" onClick={() => setVisible(!visible)}>{visible ? "Hide token" : "Show token"}</button>
          <button className="secondary-button" onClick={() => void copy(secret)}>Copy token</button>
        </div>
        <ErrorNotice error={error} /><p role="status">{notice}</p>
        <div className="form-actions"><Button onClick={close}>Done</Button></div>
      </> : <form onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true); setError("");
        try {
          const scopes: McpScope[] = ["read"];
          if (form.has("wishlist")) scopes.push("wishlist:write");
          if (form.has("availability")) scopes.push("availability:write");
          const created = await createMcpToken({ data: { name: String(form.get("name")), scopes, expiresInDays: Number(form.get("expiry")) } });
          setSecret(created.token); await reload();
        } catch (error) { setError(message(error)); }
        finally { setBusy(false); }
      }}>
        <Field label="Connection name"><input name="name" required maxLength={80} placeholder="My desktop assistant" disabled={busy} /></Field>
        <Field label="Expires after"><select name="expiry" defaultValue="90" disabled={busy}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select></Field>
        <fieldset className="connection-permissions" disabled={busy}><legend>Permissions</legend>
          <p>{scopeLabels.read} (included)</p>
          <label><input type="checkbox" name="wishlist" /> {scopeLabels["wishlist:write"]}</label>
          <label><input type="checkbox" name="availability" /> {scopeLabels["availability:write"]}</label>
        </fieldset>
        <ErrorNotice error={error} />
        <div className="form-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>Cancel</button><Button disabled={busy}>{busy ? "Creating…" : "Create token"}</Button></div>
      </form>}
    </Modal>}
  </>;
}
