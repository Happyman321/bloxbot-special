import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addImageGeneration,
  createImageProject,
  deleteImageProject,
  loadImageProjects,
  renameImageProject,
} from "@/lib/imageProjects";
import { qk } from "@/lib/queryKeys";
import type { ImageProject, ImageResult, ImageTurn, ImageUsageRecord } from "@/types/image";

export function useImageProjects() {
  return useQuery({
    queryKey: qk.imageProjects,
    queryFn: loadImageProjects,
  });
}

export function useCreateImageProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createImageProject,
    onSuccess: (project) => {
      queryClient.setQueryData<ImageProject[]>(qk.imageProjects, (prev) => [
        project,
        ...(prev ?? []),
      ]);
    },
  });
}

export function useDeleteImageProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteImageProject,
    onSuccess: (_, projectId) => {
      queryClient.setQueryData<ImageProject[]>(qk.imageProjects, (prev) =>
        (prev ?? []).filter((project) => project.id !== projectId),
      );
    },
  });
}

export function useRenameImageProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) =>
      renameImageProject(projectId, title),
    onSuccess: (_, { projectId, title }) => {
      queryClient.setQueryData<ImageProject[]>(qk.imageProjects, (prev) =>
        (prev ?? []).map((project) =>
          project.id === projectId
            ? { ...project, title: title.trim(), updatedAt: Date.now() }
            : project,
        ),
      );
    },
  });
}

export function useAddImageGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      projectId: string;
      turn: ImageTurn;
      results: ImageResult[];
      usageRecord?: ImageUsageRecord;
    }) => addImageGeneration(input),
    onSuccess: (project) => {
      queryClient.setQueryData<ImageProject[]>(qk.imageProjects, (prev) =>
        [project, ...(prev ?? []).filter((item) => item.id !== project.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
    },
  });
}
