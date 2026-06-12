import { Github } from "lucide-react";

export type WorkspaceStatusTone = "ready" | "running" | "warning";

interface StatusBarProps {
  statusLabel: string;
  tone: WorkspaceStatusTone;
  solverMode: "browser" | "api";
  modelName: string | null;
  faceCount: number;
  preservedCount: number;
  fixedCount: number;
  outcomeCount: number;
  studyId: string | null;
}

export function StatusBar({
  statusLabel,
  tone,
  solverMode,
  modelName,
  faceCount,
  preservedCount,
  fixedCount,
  outcomeCount,
  studyId
}: StatusBarProps) {
  return (
    <footer className="status-strip" aria-label="Workspace status">
      <div className="status-groups">
        <span className={`status-state ${tone}`}><i />{statusLabel}</span>
        <span><b>solver</b>{solverMode}</span>
        <span><b>model</b>{modelName ?? "none"}</span>
        {modelName && <span><b>faces</b>{faceCount.toLocaleString()}</span>}
        <span><b>preserved</b>{preservedCount}</span>
        <span><b>fixed</b>{fixedCount}</span>
        <span><b>outcomes</b>{outcomeCount}</span>
        {studyId && <span><b>study</b>{studyId}</span>}
      </div>
      <div className="status-links">
        <a className="status-link" href="https://github.com/esaueng/OpenTOS" target="_blank" rel="noreferrer">
          <Github size={13} aria-hidden="true" />
          github
        </a>
      </div>
    </footer>
  );
}
