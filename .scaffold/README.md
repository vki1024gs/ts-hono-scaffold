# Scaffold guidance

Before initialization, this directory is the single source of scaffold design, customization, deployment, frontend and recipe guidance. There must not also be a `docs/scaffold/` copy in the scaffold repository.

First initialization converts the clone in place. It moves this reusable guidance tree to `docs/scaffold/`, moves the root maintainer rules to inactive `.scaffold/SCAFFOLD_MAINTAINER.md`, writes concise application-only rules at root `AGENTS.md`, resets `PROJECT_STATUS.md` to pending, and removes completed maintainer PRDs and release implementation evidence. After that transition, `docs/scaffold/` is the generated application's single version-matched reference snapshot; `.scaffold/` retains only application identity and inactive provenance. Reconfiguration must preserve both the application's own rules and the relocated snapshot.

- [Customization](CUSTOMIZATION.md)
- [Design](DESIGN.md)
- [Deployment](DEPLOYMENT.md)
- [Frontend and Ant Design decisions](FRONTEND.md)
- [Optional recipes](recipes/README.md)

Nothing in this directory is enabled automatically. When adopting a recipe, add its dependency deliberately, adapt the example to the application, verify the result, and record the actual decision in the application's own documentation. Later scaffold pulls do not update an initialized application's snapshot automatically.

Before delivering a release: align versions, run pnpm verify, verify a fresh frozen-install generated project, prove the dependency-free production projection, managed start/smoke/stop, and validate each delivered recipe independently. After committing the intended release, run `pnpm verify:push` from the clean worktree. Generated and recipe verification removes temporary copies on success or failure; set `SCAFFOLD_KEEP_FAILED_VERIFY=1` only for a deliberate diagnostic run. CI targets Windows/Linux/macOS; local results, configured jobs and actual remote passes are separate claims. Update README, AGENTS, operations and PROJECT_STATUS to reflect the actual implementation.
