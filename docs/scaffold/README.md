# Scaffold reference snapshot

This directory contains optional implementation guidance inherited from the scaffold version recorded in `.scaffold/project.json`. It is reference material, not an active rule file: the application's root `AGENTS.md`, architecture decisions and current code take precedence.

First initialization moves the version-matched examples into `docs/scaffold/recipes/` and reports this location in its completion output. Nothing here is enabled automatically. When adopting a recipe, add the dependency deliberately, adapt the example to the application, verify the result, and record the actual decision in the application's own documentation.

- [Frontend and Ant Design decisions](frontend.md)
- `recipes/README.md`: version-matched optional implementation recipes available after initialization

Later scaffold pulls do not update this snapshot automatically. Compare upstream changes before replacing any adopted application code or local documentation.
