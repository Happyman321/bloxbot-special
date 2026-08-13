import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { qk } from "@/lib/queryKeys";

export type SkillSource = "builtin" | "user";

export interface SkillSummary {
  id: string;
  description: string;
  source: SkillSource;
  enabled: boolean;
  editable: boolean;
}

export interface SkillDocument extends SkillSummary {
  instructions: string;
}

export interface SkillDraft {
  id: string;
  description: string;
  instructions: string;
}

export interface SkillMutationResult {
  skill: SkillSummary;
  restartRequired: boolean;
}

export function useBloxbotSkills() {
  return useQuery({
    queryKey: qk.skills,
    queryFn: () => invoke<SkillSummary[]>("list_bloxbot_skills"),
    staleTime: 30_000,
  });
}

export const getBloxbotSkill = (id: string) => invoke<SkillDocument>("get_bloxbot_skill", { id });

export const saveBloxbotSkill = (draft: SkillDraft) =>
  invoke<SkillMutationResult>("save_bloxbot_skill", { draft });

export const duplicateBloxbotSkill = (sourceId: string, newId: string) =>
  invoke<SkillMutationResult>("duplicate_bloxbot_skill", { sourceId, newId });

export const setBloxbotSkillEnabled = (id: string, enabled: boolean) =>
  invoke<SkillMutationResult>("set_bloxbot_skill_enabled", { id, enabled });

export const deleteBloxbotSkill = (id: string) =>
  invoke<SkillMutationResult>("delete_bloxbot_skill", { id });
