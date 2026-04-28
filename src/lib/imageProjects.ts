import { LazyStore } from "@tauri-apps/plugin-store";
import type { ImageProject, ImageResult, ImageTurn, ImageUsageRecord } from "@/types/image";

const store = new LazyStore("bloxbot-openrouter-images.json");
const PROJECTS_KEY = "openRouterImageProjectsV1";

function now() {
  return Date.now();
}

function makeId(prefix: string) {
  return `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromPrompt(prompt: string) {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Untitled image project";
  return trimmed.length > 46 ? `${trimmed.slice(0, 43)}...` : trimmed;
}

export async function loadImageProjects(): Promise<ImageProject[]> {
  try {
    const raw = await store.get<ImageProject[]>(PROJECTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((project) => ({
        ...project,
        turns: project.turns ?? [],
        results: project.results ?? [],
        usageRecords: project.usageRecords ?? [],
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveImageProjects(projects: ImageProject[]): Promise<void> {
  await store.set(
    PROJECTS_KEY,
    [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export async function createImageProject(title = "New image project"): Promise<ImageProject> {
  const projects = await loadImageProjects();
  const timestamp = now();
  const project: ImageProject = {
    id: makeId("img_project"),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
    results: [],
    usageRecords: [],
  };
  await saveImageProjects([project, ...projects]);
  return project;
}

export async function deleteImageProject(projectId: string): Promise<void> {
  const projects = await loadImageProjects();
  await saveImageProjects(projects.filter((project) => project.id !== projectId));
}

export async function renameImageProject(projectId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const projects = await loadImageProjects();
  await saveImageProjects(
    projects.map((project) =>
      project.id === projectId ? { ...project, title: trimmed, updatedAt: now() } : project,
    ),
  );
}

export async function addImageGeneration(input: {
  projectId: string;
  turn: ImageTurn;
  results: ImageResult[];
  usageRecord?: ImageUsageRecord;
}): Promise<ImageProject> {
  const projects = await loadImageProjects();
  const timestamp = now();
  let updatedProject: ImageProject | null = null;
  const nextProjects = projects.map((project) => {
    if (project.id !== input.projectId) return project;
    const shouldRetitle =
      project.turns.length === 0 && project.title.toLowerCase() === "new image project";
    updatedProject = {
      ...project,
      title: shouldRetitle ? titleFromPrompt(input.turn.prompt) : project.title,
      turns: [...project.turns, input.turn],
      results: [...project.results, ...input.results],
      usageRecords: input.usageRecord
        ? [...project.usageRecords, input.usageRecord]
        : project.usageRecords,
      updatedAt: timestamp,
    };
    return updatedProject;
  });

  if (!updatedProject) throw new Error("Image project not found");
  await saveImageProjects(nextProjects);
  return updatedProject;
}

export function createImageTurn(input: Omit<ImageTurn, "id" | "createdAt">): ImageTurn {
  return {
    ...input,
    id: makeId("img_turn"),
    createdAt: now(),
  };
}

export function createImageUsageRecord(
  input: Omit<ImageUsageRecord, "id" | "createdAt" | "source">,
): ImageUsageRecord {
  return {
    ...input,
    id: makeId("img_usage"),
    source: "openrouter",
    createdAt: now(),
  };
}
