# Engineering notebooks

These pages preserve useful details from earlier implementation and debugging sessions. They are
kept separate from the guides so that first-time readers do not have to follow issue histories,
one developer's machine setup or long experiment logs to use Meld.

## Start with a guide

| If you want to… | Read |
| --- | --- |
| Use the editor | [Getting started](../getting-started.md) and the [manual](../MANUAL.md) |
| Write a map into the game | [Saving, compiling and playing](../guides/saving-and-compiling.md) |
| Build or change Meld | [Development](../development.md) and [Testing](../TESTS.md) |
| Find code and format constraints | [Architecture overview](../architecture/index.md) |

## Retained material

- [Testing notebook](testing-notes.md): detailed probe helpers, file inspection, browser debugging,
  performance experiments and the original heading-by-heading feature-check index.
- [Benilla integration notebook](benilla-notes.md): historical setup, format cross-checks and
  rendering-port investigations.
- [Editor feature inventory](editor-notes.md): the previous dense tool/menu inventory, preserved
  for details that may help when investigating a feature.
- [Design draft](../DESIGN.md): original project priorities and policy. Its historical scope is not
  a current feature list; for example, Lua scripting has since been implemented.

Detailed regression recipes remain under the Testing sidebar, and subsystem implementation notes
remain under Architecture. Their paths are unchanged.

## How to read and maintain these notes

- Treat dated timings and paths as examples from a particular investigation, not setup requirements
  or performance guarantees.
- Issue numbers explain provenance; a closed issue or a completed checklist is not a current roadmap.
- Prefer current code and the focused guides when an older note contradicts operating behavior.
- Keep the observation and its reproduction steps together. For a reusable check, prefer a test or
  probe and document the command in the appropriate feature-check page.
- Promote a settled workflow into a guide rather than making users reconstruct it from the notebook.

In particular, old notes saying a compile or publish restarts the game describe superseded behavior.
Those operations now wait for the author to close the game and stop the world server when needed.
Explicit Launch remains separate and can close the game to reposition the character.
