import type { ReactNode } from "react";

interface AppShellProps {
  topBar: ReactNode;
  stepBar: ReactNode;
  viewer: ReactNode;
  contextPanel: ReactNode;
  outcomePanel: ReactNode;
  statusBar: ReactNode;
}

/**
 * Workspace layout: top status/project bar, left workflow navigation, central
 * viewport, right context panel, bottom outcome strip, and a status strip.
 */
export function AppShell({ topBar, stepBar, viewer, contextPanel, outcomePanel, statusBar }: AppShellProps) {
  return (
    <div className="app-shell">
      {topBar}
      <main className="workspace">
        {stepBar}
        {viewer}
        {contextPanel}
      </main>
      {outcomePanel}
      {statusBar}
    </div>
  );
}
