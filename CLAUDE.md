# System Design Viewer

Zoomable canvas of a system landscape (systems › modules › models), defined as YAML entity
files and validated. App and CLI in `tool/`; example design in `examples/commerce/`.

- Schema cookbooks: `docs/schema/` (read before editing entity files).
- Open goals: `docs/goals.md` (remove goals once achieved).

## Workflow

- Work in a dedicated git worktree when possible, to avoid conflicts with other agents.
- App design lives in this artifact: https://claude.ai/artifact/SLDH7syQim113x4bTbZoMw?sk=jtig3xAajYzEC0L6-8d83g#page-dcb81aee8d83
  Design new features there and get them reviewed before implementing; keep it in sync with the app.
