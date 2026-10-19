import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AppShell } from "../components/app";
import "../styles.css";
import type { ReactNode } from "react";
export const Route = createRootRoute({
  ssr: false,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "WoW Forever · The War Room" },
    ],
  }),
  component: Root,
  shellComponent: Document,
  notFoundComponent: () => (
    <div className="center-page">
      <h1>Off the map</h1>
      <p>This page could not be found.</p>
      <a href="/">Return to squads</a>
    </div>
  ),
});
function Root() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
