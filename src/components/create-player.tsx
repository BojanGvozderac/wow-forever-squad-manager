import { useState } from "react";
import { UserPlus } from "lucide-react";
import { createPlayer } from "../server/api";
import { Button, ErrorNotice, Field, Modal, message } from "./app";

export function CreatePlayer() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [created, setCreated] = useState<{ username: string; key: string } | null>(null);
  const close = () => { if (!busy) { setOpen(false); setCreated(null); setError(""); setShowKey(false); } };
  return <>
    <button className="secondary-button create-player-button" onClick={() => setOpen(true)}>
      <UserPlus size={16} /> Create player
    </button>
    {open && <Modal title={created ? "Player created" : "Create player"} onClose={close}>
      {created ? <>
        <p className="modal-intro">Save this login key and share it with {created.username}. It cannot be retrieved after closing this dialog.</p>
        <Field label="Player username"><input readOnly value={created.username} /></Field>
        <Field label="Generated login key"><input id="generated-login-key" type={showKey ? "text" : "password"} readOnly value={created.key} onFocus={(event) => event.target.select()} autoComplete="off" spellCheck={false} /></Field>
        <button type="button" className="secondary-button" aria-controls="generated-login-key" onClick={() => setShowKey((visible) => !visible)}>
          {showKey ? "Hide login key" : "Show login key"}
        </button>
        <div className="form-actions"><Button onClick={close}>Done</Button></div>
      </> : <form onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true); setError("");
        try {
          const result = await createPlayer({ data: { username: String(form.get("username")) } });
          setShowKey(false);
          setCreated({ username: result.user.username, key: result.key });
        } catch (error) { setError(message(error)); }
        finally { setBusy(false); }
      }}>
        <p className="modal-intro">Creates a player account with a generated login key. Players can edit wishlists for characters assigned to them.</p>
        <Field label="Player username"><input name="username" required maxLength={80} pattern="[a-z0-9_\-]+" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} /></Field>
        <p className="field-hint">Lowercase letters, numbers, underscores, and hyphens. The name admin is reserved.</p>
        <ErrorNotice error={error} />
        <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><Button disabled={busy}>{busy ? "Creating…" : "Create player account"}</Button></div>
      </form>}
    </Modal>}
  </>;
}
