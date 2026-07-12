import type { ProblemDetails, ProjectSummary } from "@contracts/index";
import { z } from "zod";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
export const apiUrl = (path: string) => (API_BASE ? `${API_BASE}${path}` : path);

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeStudyId: z.string().nullable().optional(),
  activeRunId: z.string().nullable().optional()
});

const problemSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  code: z.string(),
  requestId: z.string().optional()
});

export class ApiProblem extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
    this.name = "ApiProblem";
  }
}

async function decodeResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const parsed = problemSchema.safeParse(payload);
    throw new ApiProblem(
      parsed.success
        ? parsed.data
        : {
            type: "about:blank",
            title: "Request failed",
            status: response.status,
            detail: typeof payload === "string" && payload ? payload : `Request failed (${response.status})`,
            code: "request_failed"
          }
    );
  }
  return payload;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch(apiUrl("/api/v3/projects"));
  const payload = await decodeResponse(response);
  return z.array(projectSchema).parse(payload) as ProjectSummary[];
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const response = await fetch(apiUrl("/api/v3/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  return projectSchema.parse(await decodeResponse(response)) as ProjectSummary;
}

export function isApiSolver(): boolean {
  return import.meta.env.VITE_SOLVER_MODE === "api";
}
