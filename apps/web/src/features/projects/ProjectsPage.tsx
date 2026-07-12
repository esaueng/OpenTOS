import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Box, Clock3, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { createProject, isApiSolver, listProjects } from "../../app/api";

export function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Connecting Rod Study");
  const apiMode = isApiSolver();
  const projects = useQuery({ queryKey: ["projects"], queryFn: listProjects, enabled: apiMode, retry: 1 });
  const create = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}/setup`);
    }
  });

  function start() {
    if (apiMode) create.mutate(name.trim() || "Untitled Study");
    else navigate("/projects/local/setup");
  }

  return <main className="projects-page">
    <section className="projects-hero"><span>GENERATIVE STRUCTURAL DESIGN</span><h1>Move from load case to decisions, with the evidence attached.</h1><p>Define a study, compare generated candidates, and keep preview results visibly separate from engineering verification.</p></section>
    <section className="new-project-card"><div><Box size={22} /><div><strong>New study</strong><span>{apiMode ? "Saved to the project workspace" : "Runs locally in this browser"}</span></div></div><label>Project name<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" type="button" disabled={create.isPending} onClick={start}><Plus size={16} />{create.isPending ? "Creating…" : "Create project"}</button>{create.error && <p className="inline-error" role="alert">{create.error.message}</p>}</section>
    <section className="recent-projects"><div className="section-heading"><div><span>WORKSPACE</span><h2>Recent projects</h2></div>{apiMode && <button className="text-button" type="button" onClick={() => void projects.refetch()}>Refresh</button>}</div>
      <div className="project-list">
        {!apiMode && <Link to="/projects/local/setup" className="project-row"><span className="project-icon"><Box size={18} /></span><div><strong>Connecting Rod Study</strong><span>Local preview workspace</span></div><span><Clock3 size={14} />Not yet run</span><ArrowRight size={17} /></Link>}
        {apiMode && projects.isLoading && <div className="project-placeholder">Loading projects…</div>}
        {apiMode && projects.isError && <div className="project-placeholder error">Unable to load the project API. Check VITE_API_BASE and the backend.</div>}
        {projects.data?.map((project) => <Link key={project.id} to={`/projects/${project.id}/setup`} className="project-row"><span className="project-icon"><Box size={18} /></span><div><strong>{project.name}</strong><span>{project.id}</span></div><span><Clock3 size={14} />{new Date(project.updatedAt).toLocaleDateString()}</span><ArrowRight size={17} /></Link>)}
        {apiMode && projects.data?.length === 0 && <div className="project-placeholder">No projects yet. Create the first one above.</div>}
      </div>
    </section>
  </main>;
}
