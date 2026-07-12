import { Box, FolderOpen, Settings2 } from "lucide-react";
import { NavLink } from "react-router-dom";

interface AppHeaderProps {
  projectId?: string;
  projectName?: string;
}

export function AppHeader({ projectId = "local", projectName = "Connecting Rod Study" }: AppHeaderProps) {
  return (
    <header className="app-header">
      <NavLink className="brand" to="/projects" aria-label="OpenTOS projects">
        <Box size={18} strokeWidth={2.2} />
        <span>OpenTOS</span>
      </NavLink>
      <nav className="primary-nav" aria-label="Primary navigation">
        <NavLink to="/projects"><FolderOpen size={15} />Projects</NavLink>
        <NavLink to={`/projects/${projectId}/setup`}>Setup</NavLink>
        <NavLink to={`/projects/${projectId}/results`}>Results</NavLink>
      </nav>
      <div className="project-identity">
        <span>{projectName}</span>
        <button className="icon-button" type="button" aria-label="Project settings"><Settings2 size={16} /></button>
      </div>
    </header>
  );
}
