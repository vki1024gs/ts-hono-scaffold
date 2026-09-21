# Maintainer guidance

This directory contains scaffold design/customization/deployment guidance. `recipes/` is maintainer-only optional source; initialization excludes it from generated projects. `.scaffold/project.json` is created on initialization and records immutable original scaffoldVersion plus application identity/settings.

First initialization converts the clone in place. It moves the root maintainer rules to inactive `SCAFFOLD_MAINTAINER.md`, writes concise application rules at root `AGENTS.md`, resets `PROJECT_STATUS.md` to pending, and removes completed maintainer PRDs, release implementation evidence and recipe sources. Reconfiguration must preserve the generated application's own agent rules.

Before delivering a release: align versions, run pnpm verify, verify a fresh frozen-install generated project, prove the dependency-free production projection, managed start/smoke/stop, and validate each delivered recipe independently. After committing the intended release, run `pnpm verify:push` from the clean worktree. CI targets Windows/Linux/macOS; local results, configured jobs and actual remote passes are separate claims. Update README, AGENTS, operations and PROJECT_STATUS to reflect the actual implementation.
