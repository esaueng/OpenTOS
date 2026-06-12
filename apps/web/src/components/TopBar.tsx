import { Play } from "lucide-react";

interface TopBarProps {
  modelName: string | null;
  units: string;
  running: boolean;
  canRun: boolean;
  missingRunItems: string[];
  onRun: () => void;
}

function OpenTosMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.6 21 7.8v8.4L12 21.4 3 16.2V7.8L12 2.6Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.2 16.5 9.8v4.4L12 16.8 7.5 14.2V9.8L12 7.2Z" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
    </svg>
  );
}

export function TopBar({ modelName, units, running, canRun, missingRunItems, onRun }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <OpenTosMark />
        OpenTOS <span className="brand-tag">Generative</span>
      </div>
      <div className="topbar-divider" />
      <div className="breadcrumb">
        <span className="breadcrumb-chip">{modelName ?? "No model"}</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-chip">{units}</span>
      </div>
      <div className="topbar-tools">
        <button
          type="button"
          className={`primary topbar-action ${running ? "running" : ""}`}
          disabled={!canRun}
          onClick={onRun}
          title={missingRunItems.length ? `Complete before running: ${missingRunItems.join(", ")}` : "Run generative study"}
        >
          <Play size={15} aria-hidden="true" />
          {running ? "Generating…" : "Run study"}
        </button>
      </div>
    </header>
  );
}
