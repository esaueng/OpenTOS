import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";

import { useStudyStore } from "./app/store";
import { AppHeader } from "./components/AppHeader";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import "./styles.css";

const SetupWorkspace = lazy(() => import("./features/study/SetupWorkspace").then((module) => ({ default: module.SetupWorkspace })));
const ResultsWorkspace = lazy(() => import("./features/results/ResultsWorkspace").then((module) => ({ default: module.ResultsWorkspace })));

function WorkspaceFallback() {
  return <div className="workspace-loading" role="status">Loading workspace…</div>;
}

function ProjectShell() {
  const { projectId } = useParams();
  const projectName = useStudyStore((state) => state.projectName);
  return <div className="application-shell"><AppHeader projectId={projectId} projectName={projectName} /><Outlet /></div>;
}

export default function App() {
  return <Routes>
    <Route element={<div className="application-shell"><AppHeader /><Outlet /></div>}>
      <Route path="/projects" element={<ProjectsPage />} />
    </Route>
    <Route path="/projects/:projectId" element={<ProjectShell />}>
      <Route path="setup" element={<Suspense fallback={<WorkspaceFallback />}><SetupWorkspace /></Suspense>} />
      <Route path="results" element={<Suspense fallback={<WorkspaceFallback />}><ResultsWorkspace /></Suspense>} />
      <Route index element={<Navigate replace to="setup" />} />
    </Route>
    <Route path="*" element={<Navigate replace to="/projects" />} />
  </Routes>;
}
