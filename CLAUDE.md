# System Design Viewer

Zoomable canvas of a system landscape (systems › modules › models), defined as YAML entity
files and validated. App and CLI in `tool/`; example design in `examples/commerce/`.

- Schema cookbooks: `docs/schema/` (read before editing entity files).
- Open goals: `docs/goals.md` (remove goals once achieved).

## Workflow

- Do each task in a new git worktree on its own branch off `origin/main` (`git fetch` first), to
  avoid conflicts with other agents.
- When done, don't wait to be asked, and push without asking:
  1. In the worktree: commit, `git fetch`, rebase onto `origin/main`.
  2. Fast-forward `origin/main` to the branch: `git push origin HEAD:main`. If rejected
     (someone pushed meanwhile), fetch, rebase and push again; never force.
  3. In the main checkout: `git pull --ff-only` on `main`.
  4. Remove the worktree and delete the branch. The user reviews on `main`.
- Follow-ups and corrections are new tasks in a new worktree.
- App design lives in this artifact: https://claude.ai/artifact/SLDH7syQim113x4bTbZoMw?sk=jtig3xAajYzEC0L6-8d83g#page-dcb81aee8d83
  Design new features there and get them reviewed before implementing; keep it in sync with the app.
