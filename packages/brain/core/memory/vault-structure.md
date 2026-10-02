# Vault Structure — PARA Method

The brain vault follows the PARA method (Projects, Areas, Resources, Archive) for organizing knowledge. This structure is the recommended default for new workspaces.

## Folder Structure

```
vault/
  00-inbox/          # Capture — unsorted notes, quick thoughts, clippings
  01-projects/       # Active projects with defined outcomes and deadlines
  02-areas/          # Ongoing areas of responsibility (no end date)
  03-resources/      # Reference material, topics of interest
  04-templates/      # Reusable templates for notes, meetings, decisions
  05-knowledge/      # Synthesized learnings, skill documents, how-tos
  06-daily/          # Daily notes, journals, standups
  07-archive/        # Completed projects, inactive areas, old resources
```

## Folder Descriptions

### 00-inbox

The capture point. Everything starts here. Process regularly (daily or weekly) by moving notes to the appropriate folder.

- Quick thoughts and ideas
- Meeting notes (before processing)
- Web clippings and bookmarks
- Voice note transcripts

### 01-projects

Active work with a defined outcome and timeline. Each project gets a subfolder.

- Project plans and PRDs
- Sprint documents
- Task breakdowns
- Progress notes

### 02-areas

Ongoing responsibilities without an end date. These represent roles, standards, or recurring concerns.

- Health & fitness tracking
- Financial planning
- Career development
- Team management notes

### 03-resources

Reference material organized by topic. Things you want to remember but aren't actively working on.

- Technology comparisons
- Industry research
- Book notes and highlights
- Course materials

### 04-templates

Reusable structures for common note types.

- Meeting note template
- Decision record template
- Project kickoff template
- Retrospective template
- 1:1 meeting template

### 05-knowledge

Synthesized, high-quality documents that represent learned skills or deep understanding.

- Technical deep-dives
- Process documentation
- Best practices guides
- Lessons learned

### 06-daily

Chronological daily notes for journaling, standups, or daily planning.

- Named by date: `2026-03-11.md`
- Daily standup notes
- End-of-day reflections
- Time tracking

### 07-archive

Completed or inactive items moved from other folders. Preserves history without cluttering active views.

- Completed projects (from 01-projects)
- Deprecated resources
- Old templates replaced by newer versions

## Processing Rules

1. **Inbox Zero**: Process inbox at least weekly. Move each note to the right folder or delete it.
2. **Project Lifecycle**: When a project completes, move its folder to 07-archive.
3. **Area Review**: Review areas monthly to ensure they still reflect current responsibilities.
4. **Resource Freshness**: Archive resources that haven't been referenced in 6+ months.
5. **Knowledge Extraction**: After completing a project, extract key learnings into 05-knowledge.

## File Naming Conventions

- Use lowercase with hyphens: `my-note-title.md`
- Prefix date for chronological notes: `2026-03-11-meeting-notes.md`
- Use descriptive names that are searchable without opening the file
