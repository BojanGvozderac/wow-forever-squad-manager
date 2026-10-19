import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  LogOut,
  Shield,
  Swords,
  Users,
  X,
  RefreshCw,
} from "lucide-react";
import { getSession, logout, type User } from "../server/api";
import { Button } from "./ui/warcraftcn/button";
import { CreatePlayer } from "./create-player";
export { Button };
const UserContext = createContext<User | null>(null);
export function useUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error("Sign in required");
  return user;
}
export function AppShell({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ user: User | null } | null>(null);
  const [error, setError] = useState("");
  const [checkedPath, setCheckedPath] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin =
    useRouterState({ select: (state) => state.matches.at(-1)?.routeId }) ===
    "/login";
  useEffect(() => {
    let active = true;
    const check = () => {
      if (document.visibilityState === "visible")
        getSession()
          .then((next) => {
            if (active) {
              setSession(next);
              setCheckedPath(location.pathname);
              setError("");
            }
          })
          .catch((e) => {
            if (active) setError(message(e));
          });
    };
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [location.pathname]);
  useEffect(() => {
    if (
      session &&
      checkedPath === location.pathname &&
      !session.user &&
      !isLogin
    )
      void navigate({ to: "/login" });
  }, [session, checkedPath, location.pathname, isLogin, navigate]);
  if (isLogin) return <>{children}</>;
  if (error)
    return (
      <main className="center-page">
        <ErrorNotice error={error} />
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </main>
    );
  if (!session?.user)
    return (
      <main className="center-page">
        <Shield size={40} />
        <p>Loading…</p>
      </main>
    );
  return (
    <UserContext.Provider value={session.user}>
      <div className="app-layout">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <div className="brand-mark">
              <Swords size={25} />
            </div>
            <span>
              WOW FOREVER<small>THE WAR ROOM</small>
            </span>
          </Link>
          <nav>
            <Link
              to="/"
              className="nav-item"
              activeProps={{ className: "nav-item active" }}
            >
              <Users size={18} /> Squads <ChevronRight size={15} />
            </Link>
          </nav>
          <div className="account">
            <div className="account-avatar">
              {session.user.username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{session.user.username}</strong>
              <small>
                {session.user.role === "admin"
                  ? "Guild administrator"
                  : "Guild member"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await logout();
                setSession({ user: null });
                void navigate({ to: "/login" });
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <div className="main-wrap">
          <header className="topbar">
            <span>
              <span className="region-dot" /> PRIVATE GUILD SPACE
            </span>
            {session.user.role === "admin" && <CreatePlayer />}
            <span className="topbar-right">
              <Shield size={14} /> EU RULESETS{" "}
              <span className="separator">/</span> <span>WoW Forever</span>
            </span>
          </header>
          <main className="content">{children}</main>
          <footer className="footer">
            <span>
              WoW Forever Team Viewer <span className="gold">✦</span>
            </span>
          </footer>
        </div>
      </div>
    </UserContext.Provider>
  );
}
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const value = await loader();
      setData(value);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, deps);
  useEffect(() => {
    setLoading(true);
    void reload();
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const interval = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);
  return { data, error, loading, reload };
}
export function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Something went wrong. Please try again.";
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div className="error-notice" role="alert">
      {error}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <RefreshCw size={19} className="spin" /> Loading…
    </div>
  );
}
export function Empty({
  title,
  children,
  icon = "shield",
}: {
  title: string;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {icon === "users" ? <Users size={32} /> : <Shield size={32} />}
      </div>
      <h3>{title}</h3>
      <div className="empty-copy">{children}</div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow"><span /> {eyebrow}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
export function BackLink() {
  return (
    <Link to="/" className="back-link">
      <ArrowLeft size={15} /> All squads
    </Link>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="info-note">
      <CircleHelp size={17} />
      <span>{children}</span>
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function LastRefresh({ at }: { at: string | null }) {
  return <span>{at ? new Date(at).toLocaleString() : "Never refreshed"}</span>;
}
