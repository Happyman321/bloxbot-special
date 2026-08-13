use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SKILL_BYTES: usize = 128 * 1024;
const MAX_ID_CHARS: usize = 64;
const MAX_DESCRIPTION_CHARS: usize = 1024;
const BUILTIN_PREFIX: &str = "bloxbot-";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    Builtin,
    User,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub id: String,
    pub description: String,
    pub source: SkillSource,
    pub enabled: bool,
    pub editable: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDocument {
    #[serde(flatten)]
    pub summary: SkillSummary,
    pub instructions: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDraft {
    pub id: String,
    pub description: String,
    pub instructions: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMutationResult {
    pub skill: SkillSummary,
    pub restart_required: bool,
}

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillState {
    #[serde(default)]
    disabled_skill_ids: BTreeSet<String>,
}

struct SkillStore {
    workspace_root: PathBuf,
    builtin_root: PathBuf,
    user_root: PathBuf,
    state_root: PathBuf,
}

impl SkillStore {
    fn global() -> Result<Self, String> {
        let workspace = crate::paths::workspace_dir()?;
        Ok(Self {
            workspace_root: workspace.clone(),
            builtin_root: crate::paths::bundled_skills_dir()?,
            user_root: workspace.join(".agents").join("skills"),
            state_root: workspace.join(".bloxbot"),
        })
    }

    #[cfg(test)]
    fn for_test(root: &Path) -> Self {
        Self {
            workspace_root: root.to_path_buf(),
            builtin_root: root.join("builtin"),
            user_root: root.join("user"),
            state_root: root.join("state"),
        }
    }

    fn prepare(&self) -> Result<(), String> {
        fs::create_dir_all(&self.user_root)
            .map_err(|e| format!("Failed to create user skills directory: {e}"))?;
        fs::create_dir_all(&self.state_root)
            .map_err(|e| format!("Failed to create BloxBot state directory: {e}"))?;
        if !self.builtin_root.is_dir() {
            return Err(format!(
                "Bundled skills directory is missing: {}",
                self.builtin_root.display()
            ));
        }
        let workspace = canonical_directory(&self.workspace_root, "BloxBot workspace")?;
        for (path, label) in [
            (&self.user_root, "user skills directory"),
            (&self.state_root, "BloxBot state directory"),
        ] {
            let canonical = canonical_directory(path, label)?;
            if !canonical.starts_with(&workspace) {
                return Err(format!("{label} escapes the BloxBot workspace"));
            }
        }
        canonical_directory(&self.builtin_root, "bundled skills directory")?;
        Ok(())
    }

    fn state_path(&self) -> PathBuf {
        self.state_root.join("skills-state.json")
    }

    fn read_state(&self) -> Result<SkillState, String> {
        let path = self.state_path();
        if !path.exists() {
            return Ok(SkillState::default());
        }
        reject_symlink(&path, "skill state manifest")?;
        let bytes =
            fs::read(&path).map_err(|e| format!("Failed to read skill state manifest: {e}"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid skill state manifest: {e}"))
    }

    fn write_state(&self, state: &SkillState) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(state)
            .map_err(|e| format!("Failed to serialize skill state: {e}"))?;
        atomic_write(&self.state_path(), &bytes)
    }

    fn list(&self) -> Result<Vec<SkillSummary>, String> {
        self.prepare()?;
        let state = self.read_state()?;
        let mut skills = BTreeMap::<String, SkillSummary>::new();

        for document in self.read_root(&self.builtin_root, SkillSource::Builtin)? {
            skills.insert(document.summary.id.clone(), document.summary);
        }
        for document in self.read_root(&self.user_root, SkillSource::User)? {
            if skills.contains_key(&document.summary.id) {
                return Err(format!(
                    "Skill ID '{}' collides with a bundled skill",
                    document.summary.id
                ));
            }
            skills.insert(document.summary.id.clone(), document.summary);
        }

        for summary in skills.values_mut() {
            summary.enabled = !state.disabled_skill_ids.contains(&summary.id);
        }
        Ok(skills.into_values().collect())
    }

    fn read_root(&self, root: &Path, source: SkillSource) -> Result<Vec<SkillDocument>, String> {
        let canonical_root = canonical_directory(root, "skills directory")?;
        let mut documents = Vec::new();
        for entry in fs::read_dir(root)
            .map_err(|e| format!("Failed to read skills directory '{}': {e}", root.display()))?
        {
            let entry = entry.map_err(|e| format!("Failed to read skill entry: {e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("Failed to inspect skill entry: {e}"))?;
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let id = entry
                .file_name()
                .to_str()
                .ok_or_else(|| "Skill ID must be valid UTF-8".to_string())?
                .to_string();
            validate_id(&id, source == SkillSource::Builtin)?;
            let dir = safe_existing_child(&canonical_root, &entry.path(), "skill directory")?;
            let file = dir.join("SKILL.md");
            reject_symlink(&file, "SKILL.md")?;
            let canonical_file = file
                .canonicalize()
                .map_err(|e| format!("Failed to resolve '{}': {e}", file.display()))?;
            if !canonical_file.starts_with(&canonical_root) || !canonical_file.is_file() {
                return Err(format!("Unsafe skill file path: {}", file.display()));
            }
            let bytes = fs::read(&canonical_file)
                .map_err(|e| format!("Failed to read '{}': {e}", file.display()))?;
            let mut document = parse_skill(&id, &bytes, source.clone())?;
            document.summary.enabled = true;
            documents.push(document);
        }
        Ok(documents)
    }

    fn get(&self, id: &str) -> Result<SkillDocument, String> {
        validate_id(id, true)?;
        self.prepare()?;
        let state = self.read_state()?;
        let (root, source) = if self.builtin_root.join(id).exists() {
            (&self.builtin_root, SkillSource::Builtin)
        } else if self.user_root.join(id).exists() {
            (&self.user_root, SkillSource::User)
        } else {
            return Err(format!("Skill '{id}' was not found"));
        };
        let canonical_root = canonical_directory(root, "skills directory")?;
        let dir = safe_existing_child(&canonical_root, &root.join(id), "skill directory")?;
        let file = dir.join("SKILL.md");
        reject_symlink(&file, "SKILL.md")?;
        let canonical_file = file
            .canonicalize()
            .map_err(|e| format!("Failed to resolve '{}': {e}", file.display()))?;
        if !canonical_file.starts_with(&canonical_root) || !canonical_file.is_file() {
            return Err(format!("Unsafe skill file path: {}", file.display()));
        }
        let bytes = fs::read(&canonical_file)
            .map_err(|e| format!("Failed to read '{}': {e}", file.display()))?;
        let mut document = parse_skill(id, &bytes, source)?;
        document.summary.enabled = !state.disabled_skill_ids.contains(id);
        Ok(document)
    }

    fn save(&self, draft: SkillDraft) -> Result<SkillMutationResult, String> {
        self.prepare()?;
        validate_draft(&draft, false)?;
        if self.builtin_root.join(&draft.id).exists() {
            return Err("Bundled skills cannot be modified".to_string());
        }

        let root = canonical_directory(&self.user_root, "user skills directory")?;
        let skill_dir = self.user_root.join(&draft.id);
        if skill_dir.exists() {
            safe_existing_child(&root, &skill_dir, "skill directory")?;
        } else {
            fs::create_dir(&skill_dir)
                .map_err(|e| format!("Failed to create skill directory: {e}"))?;
            safe_existing_child(&root, &skill_dir, "skill directory")?;
        }

        let contents = serialize_skill(&draft)?;
        atomic_write(&skill_dir.join("SKILL.md"), contents.as_bytes())?;
        let skill = self.get(&draft.id)?.summary;
        Ok(SkillMutationResult {
            skill,
            restart_required: true,
        })
    }

    fn duplicate(&self, source_id: &str, new_id: &str) -> Result<SkillMutationResult, String> {
        validate_id(new_id, false)?;
        if self.builtin_root.join(new_id).exists() || self.user_root.join(new_id).exists() {
            return Err(format!("Skill '{new_id}' already exists"));
        }
        let source = self.get(source_id)?;
        self.save(SkillDraft {
            id: new_id.to_string(),
            description: source.summary.description,
            instructions: source.instructions,
        })
    }

    fn set_enabled(&self, id: &str, enabled: bool) -> Result<SkillMutationResult, String> {
        let document = self.get(id)?;
        let mut state = self.read_state()?;
        if enabled {
            state.disabled_skill_ids.remove(id);
        } else {
            state.disabled_skill_ids.insert(id.to_string());
        }
        self.write_state(&state)?;
        let mut skill = document.summary;
        skill.enabled = enabled;
        Ok(SkillMutationResult {
            skill,
            restart_required: true,
        })
    }

    fn delete(&self, id: &str) -> Result<SkillMutationResult, String> {
        let document = self.get(id)?;
        if document.summary.source == SkillSource::Builtin {
            return Err("Bundled skills cannot be deleted".to_string());
        }

        let root = canonical_directory(&self.user_root, "user skills directory")?;
        let source = safe_existing_child(&root, &self.user_root.join(id), "skill directory")?;
        let trash_root = self.state_root.join("skills-trash");
        fs::create_dir_all(&trash_root)
            .map_err(|e| format!("Failed to create skill trash directory: {e}"))?;
        let canonical_state = canonical_directory(&self.state_root, "BloxBot state directory")?;
        let canonical_trash = canonical_directory(&trash_root, "skill trash directory")?;
        if !canonical_trash.starts_with(canonical_state) {
            return Err("Skill trash directory escapes the BloxBot state directory".to_string());
        }
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("System clock error: {e}"))?
            .as_millis();
        let destination = canonical_trash.join(format!("{timestamp}-{id}"));
        fs::rename(&source, &destination)
            .map_err(|e| format!("Failed to move skill to trash: {e}"))?;

        let mut state = self.read_state()?;
        state.disabled_skill_ids.remove(id);
        self.write_state(&state)?;
        Ok(SkillMutationResult {
            skill: document.summary,
            restart_required: true,
        })
    }
}

fn validate_id(id: &str, allow_reserved: bool) -> Result<(), String> {
    let length = id.chars().count();
    if length == 0 || length > MAX_ID_CHARS {
        return Err(format!("Skill ID must be 1-{MAX_ID_CHARS} characters"));
    }
    let valid = id.split('-').all(|part| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    });
    if !valid {
        return Err(
            "Skill ID must contain lowercase letters and numbers separated by single hyphens"
                .to_string(),
        );
    }
    if !allow_reserved && id.starts_with(BUILTIN_PREFIX) {
        return Err("Skill IDs beginning with 'bloxbot-' are reserved".to_string());
    }
    Ok(())
}

fn validate_draft(draft: &SkillDraft, allow_reserved: bool) -> Result<(), String> {
    validate_id(&draft.id, allow_reserved)?;
    let description_length = draft.description.chars().count();
    if description_length == 0 || description_length > MAX_DESCRIPTION_CHARS {
        return Err(format!(
            "Description must be 1-{MAX_DESCRIPTION_CHARS} characters"
        ));
    }
    if draft.instructions.trim().is_empty() {
        return Err("Instructions cannot be empty".to_string());
    }
    let serialized = serialize_skill_unchecked(draft)?;
    if serialized.len() > MAX_SKILL_BYTES {
        return Err(format!("SKILL.md must not exceed {MAX_SKILL_BYTES} bytes"));
    }
    Ok(())
}

fn serialize_skill(draft: &SkillDraft) -> Result<String, String> {
    validate_draft(draft, false)?;
    serialize_skill_unchecked(draft)
}

fn serialize_skill_unchecked(draft: &SkillDraft) -> Result<String, String> {
    let description = serde_json::to_string(&draft.description)
        .map_err(|e| format!("Failed to serialize skill description: {e}"))?;
    Ok(format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        draft.id,
        description,
        draft.instructions.trim()
    ))
}

fn parse_skill(id: &str, bytes: &[u8], source: SkillSource) -> Result<SkillDocument, String> {
    if bytes.len() > MAX_SKILL_BYTES {
        return Err(format!("Skill '{id}' exceeds {MAX_SKILL_BYTES} bytes"));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|e| format!("Skill '{id}' is not valid UTF-8: {e}"))?
        .replace("\r\n", "\n");
    let body = text
        .strip_prefix("---\n")
        .ok_or_else(|| format!("Skill '{id}' is missing YAML frontmatter"))?;
    let (frontmatter_text, instructions) = body
        .split_once("\n---\n")
        .ok_or_else(|| format!("Skill '{id}' has unterminated YAML frontmatter"))?;
    let frontmatter = parse_frontmatter(frontmatter_text)
        .map_err(|e| format!("Skill '{id}' has invalid YAML frontmatter: {e}"))?;
    if frontmatter.name != id {
        return Err(format!(
            "Skill directory '{id}' does not match frontmatter name '{}'",
            frontmatter.name
        ));
    }
    let draft = SkillDraft {
        id: id.to_string(),
        description: frontmatter.description,
        instructions: instructions.trim().to_string(),
    };
    validate_draft(&draft, source == SkillSource::Builtin)?;
    Ok(SkillDocument {
        summary: SkillSummary {
            id: draft.id,
            description: draft.description,
            editable: source == SkillSource::User,
            source,
            enabled: true,
        },
        instructions: draft.instructions,
    })
}

fn parse_frontmatter(text: &str) -> Result<SkillFrontmatter, String> {
    let mut name = None;
    let mut description = None;
    for line in text.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| format!("Expected a key/value pair in '{line}'"))?;
        let value = value.trim();
        match key.trim() {
            "name" => name = Some(parse_yaml_scalar(value)?),
            "description" => description = Some(parse_yaml_scalar(value)?),
            _ => {}
        }
    }
    Ok(SkillFrontmatter {
        name: name.ok_or_else(|| "Missing required 'name' field".to_string())?,
        description: description
            .ok_or_else(|| "Missing required 'description' field".to_string())?,
    })
}

fn parse_yaml_scalar(value: &str) -> Result<String, String> {
    if value.starts_with('"') {
        return serde_json::from_str(value)
            .map_err(|e| format!("Invalid quoted string '{value}': {e}"));
    }
    if value.starts_with('\'') {
        if value.len() < 2 || !value.ends_with('\'') {
            return Err(format!("Unterminated quoted string '{value}'"));
        }
        return Ok(value[1..value.len() - 1].replace("''", "'"));
    }
    if value.is_empty() {
        return Err("YAML value cannot be empty".to_string());
    }
    Ok(value.to_string())
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    reject_symlink(path, label)?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {label} '{}': {e}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{label} is not a directory: {}", path.display()));
    }
    Ok(canonical)
}

fn safe_existing_child(root: &Path, child: &Path, label: &str) -> Result<PathBuf, String> {
    reject_symlink(child, label)?;
    let canonical = child
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {label} '{}': {e}", child.display()))?;
    if !canonical.starts_with(root) || !canonical.is_dir() {
        return Err(format!("Unsafe {label} path: {}", child.display()));
    }
    Ok(canonical)
}

fn reject_symlink(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {label} '{}': {e}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Symlinks are not allowed for {label}"));
    }
    Ok(())
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("System clock error: {e}"))?
        .as_nanos();
    let temp = parent.join(format!(
        ".bloxbot-write-{}-{suffix}.tmp",
        std::process::id()
    ));
    let backup = parent.join(format!(
        ".bloxbot-write-{}-{suffix}.bak",
        std::process::id()
    ));
    fs::write(&temp, contents)
        .map_err(|e| format!("Failed to write temporary file '{}': {e}", temp.display()))?;

    if path.exists() {
        reject_symlink(path, "destination file")?;
        fs::rename(path, &backup)
            .map_err(|e| format!("Failed to prepare atomic file replacement: {e}"))?;
    }
    if let Err(error) = fs::rename(&temp, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temp);
        return Err(format!("Failed to finish atomic file replacement: {error}"));
    }
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|e| format!("Failed to remove atomic-write backup: {e}"))?;
    }
    Ok(())
}

pub(crate) fn disabled_skill_permission_rules() -> Result<Map<String, Value>, String> {
    let store = SkillStore::global()?;
    store.prepare()?;
    let state = store.read_state()?;
    let mut rules = Map::new();
    rules.insert("*".to_string(), Value::String("allow".to_string()));
    rules.insert(
        "customize-opencode".to_string(),
        Value::String("deny".to_string()),
    );
    for id in state.disabled_skill_ids {
        rules.insert(id, Value::String("deny".to_string()));
    }
    Ok(rules)
}

#[tauri::command]
pub fn list_bloxbot_skills() -> Result<Vec<SkillSummary>, String> {
    SkillStore::global()?.list()
}

#[tauri::command]
pub fn get_bloxbot_skill(id: String) -> Result<SkillDocument, String> {
    SkillStore::global()?.get(&id)
}

#[tauri::command]
pub fn save_bloxbot_skill(draft: SkillDraft) -> Result<SkillMutationResult, String> {
    SkillStore::global()?.save(draft)
}

#[tauri::command]
pub fn duplicate_bloxbot_skill(
    source_id: String,
    new_id: String,
) -> Result<SkillMutationResult, String> {
    SkillStore::global()?.duplicate(&source_id, &new_id)
}

#[tauri::command]
pub fn set_bloxbot_skill_enabled(id: String, enabled: bool) -> Result<SkillMutationResult, String> {
    SkillStore::global()?.set_enabled(&id, enabled)
}

#[tauri::command]
pub fn delete_bloxbot_skill(id: String) -> Result<SkillMutationResult, String> {
    SkillStore::global()?.delete(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        let id = NEXT_TEST.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("bloxbot-skills-test-{}-{id}", std::process::id()));
        fs::create_dir_all(root.join("builtin")).unwrap();
        root
    }

    fn draft(id: &str) -> SkillDraft {
        SkillDraft {
            id: id.to_string(),
            description: "A useful test skill".to_string(),
            instructions: "## Instructions\n\nDo the useful thing.".to_string(),
        }
    }

    fn write_builtin(store: &SkillStore, id: &str) {
        let directory = store.builtin_root.join(id);
        fs::create_dir_all(&directory).unwrap();
        let mut value = draft(id);
        let contents = serialize_skill_unchecked(&value).unwrap();
        fs::write(directory.join("SKILL.md"), contents).unwrap();
        value.instructions.clear();
    }

    #[test]
    fn parses_frontmatter_and_round_trips_instructions() {
        let value = draft("my-skill");
        let text = serialize_skill(&value).unwrap();
        let parsed = parse_skill("my-skill", text.as_bytes(), SkillSource::User).unwrap();
        assert_eq!(parsed.summary.description, value.description);
        assert_eq!(parsed.instructions, value.instructions);
    }

    #[test]
    fn validates_ids_descriptions_instructions_and_file_limit() {
        assert!(validate_draft(&draft("valid-skill-2"), false).is_ok());
        assert!(validate_draft(&draft("../escape"), false).is_err());
        assert!(validate_draft(&draft("Bad_ID"), false).is_err());
        assert!(validate_draft(&draft("bloxbot-reserved"), false).is_err());
        let mut empty = draft("empty");
        empty.instructions = "  ".to_string();
        assert!(validate_draft(&empty, false).is_err());
        let mut large = draft("large");
        large.instructions = "x".repeat(MAX_SKILL_BYTES);
        assert!(validate_draft(&large, false).is_err());
    }

    #[test]
    fn saves_updates_and_detects_collisions() {
        let root = test_root();
        let store = SkillStore::for_test(&root);
        write_builtin(&store, "bloxbot-built-in");
        let result = store.save(draft("user-skill")).unwrap();
        assert!(result.restart_required);
        assert!(result.skill.editable);
        let mut updated = draft("user-skill");
        updated.description = "Updated".to_string();
        store.save(updated).unwrap();
        assert_eq!(
            store.get("user-skill").unwrap().summary.description,
            "Updated"
        );
        let leftovers = fs::read_dir(store.user_root.join("user-skill"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".bloxbot-write-")
            })
            .count();
        assert_eq!(leftovers, 0, "atomic saves must clean temporary files");
        assert!(store.save(draft("bloxbot-built-in")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_managed_directories_outside_the_workspace() {
        let root = test_root();
        let outside = test_root();
        let mut store = SkillStore::for_test(&root);
        store.user_root = outside.join("user");
        assert!(store.prepare().is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn persists_enabled_state_and_emits_deny_rules() {
        let root = test_root();
        let store = SkillStore::for_test(&root);
        write_builtin(&store, "bloxbot-built-in");
        store.save(draft("user-skill")).unwrap();
        store.set_enabled("user-skill", false).unwrap();
        assert!(!store.get("user-skill").unwrap().summary.enabled);
        let state = store.read_state().unwrap();
        assert!(state.disabled_skill_ids.contains("user-skill"));
        store.set_enabled("user-skill", true).unwrap();
        assert!(!store
            .read_state()
            .unwrap()
            .disabled_skill_ids
            .contains("user-skill"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_is_the_supported_rename_path() {
        let root = test_root();
        let store = SkillStore::for_test(&root);
        write_builtin(&store, "bloxbot-built-in");
        let result = store.duplicate("bloxbot-built-in", "custom-copy").unwrap();
        assert_eq!(result.skill.id, "custom-copy");
        assert_eq!(
            store.get("custom-copy").unwrap().instructions,
            draft("bloxbot-built-in").instructions
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bundled_skills_are_immutable_and_user_deletion_is_recoverable() {
        let root = test_root();
        let store = SkillStore::for_test(&root);
        write_builtin(&store, "bloxbot-built-in");
        assert!(store.delete("bloxbot-built-in").is_err());
        store.save(draft("delete-me")).unwrap();
        store.delete("delete-me").unwrap();
        assert!(!store.user_root.join("delete-me").exists());
        let trash = fs::read_dir(store.state_root.join("skills-trash"))
            .unwrap()
            .count();
        assert_eq!(trash, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_skill_directories() {
        use std::os::unix::fs::symlink;
        let root = test_root();
        let store = SkillStore::for_test(&root);
        store.prepare().unwrap();
        let outside = root.join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, store.user_root.join("linked-skill")).unwrap();
        assert!(store.get("linked-skill").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
