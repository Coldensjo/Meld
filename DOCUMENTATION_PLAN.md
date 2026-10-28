# Living documentation roadmap

Last updated: **2026-10-28**, commit/CI and existing-live-site verification (session 9); source baseline:
`0d935acf50662d68c6b46f0381605b3e99c54b6c` (before this documentation change).
Read [audit evidence and limitations](DOCUMENTATION_AUDIT.md) and
[maintenance rules](DOCUMENTATION_RULES.md) before changing this plan. Preserve task IDs and history.

## 1. Project documentation overview

Meld is a Windows/Linux editor for WoW 1.12.1. Wails connects Go files, assets and server integration
to Svelte/TypeScript editing and Three.js rendering. Guides, architecture references, regression
recipes and historical notebooks already exist. Preserve the recent guide split at `5080b99`;
do not regenerate it. These root files are a shared documentation backlog, maintained on demand.

Reader entry points: [README](README.md), [site home](docs/index.md),
[getting started](docs/getting-started.md), [manual](docs/MANUAL.md),
[safe writes](docs/guides/saving-and-compiling.md), [development](docs/development.md),
[testing](docs/TESTS.md) and [architecture](docs/architecture/index.md).

**Coverage limit:** all 1,146 tracked paths and 35 existing Markdown documents were indexed.
Focused guides and selected source contracts were examined, not every implementation or regression
recipe. No subsystem-wide completeness or live game compatibility is claimed. Section 9 is the handoff.

**Current phase: sustainable maintenance; all currently actionable documentation tasks complete.**
DOC-006 is Done for bounded source-verifiable workflow/reference acceptance after session-7 checks;
DOC-001–009 and DOC-012 are Done. DOC-011 retains its source-backed precautions and is Blocked on
native/distributor verification. DOC-010 remains Deferred for owner approval. No P0/P1 remains open.
This closes initial creation, not subsystem-wide implementation or native/game certification.

**Publication handoff (session 9):** the documentation and CI changes are prepared for a dedicated
local commit. Publication is pending explicit authorization to push `main`; no new deployment or
remote CI run is claimed. Existing-site browser checks passed basic navigation/search/responsiveness
but exposed theme accessibility findings tracked as DOC-013 P2 Ready/Todo below. The two new guide
URLs currently return 404 because they have not been published. See the latest audit entry.

All 14 parent subsystems remain **Broadly Audited**, none Unaudited or Deeply Audited as a whole.
The [inspection register](DOCUMENTATION_AUDIT.md#inspection-register-current) retains static-depth
labels separately. New guides cover source-verified workflows, not every implementation detail;
remaining Partial/Unverified areas stay visible below. Reuse completed DA-01/02/05 evidence and
session-6/7 task results; use the event-triggered maintenance queue in section 6, not another broad audit.

## 2. Existing documentation inventory

Classification is for the stated purpose, not a quality score. Unverified means indexed/sampled,
not exhaustively compared with source. Paths below are repository-relative. Newly added pages are included.

| Location | Purpose / audience | Concepts and source evidence | State / improvement |
| --- | --- | --- | --- |
| `README.md` | Entry, authors/contributors | Requirements, commands, guides; `go.mod`, `Makefile`, `wails.json` | Partial: commands checked; session-8 checkout/dependency route and conditional WebView2 prerequisite corrected; native onboarding untested |
| `docs/index.md` | Site routes, all readers | Canonical guide links; site config | Complete for entry-page scope after build; browser not checked |
| `docs/getting-started.md` | First edits, authors | Client/project, world/region, controls, Save As; `app_project.go`, `io/project.ts`, commands | Partial: source samples, no first-run walkthrough |
| `docs/MANUAL.md` | Tools, camera, menus, authors | Tools/keys/Lua, generation/exchange/check/preview tasks and authoring links | Complete for bounded source-verified author orientation (DOC-006/008); native walkthrough and exhaustive tool fidelity unverified |
| `docs/guides/saving-and-compiling.md` | Safe writes/recovery, authors | Working files, client/server, pending; `io/compile.ts`, `vmangos/install.go`, `pending.go`, `publish.go` | Complete for source-verified write/recovery scope; session-8 exact extractor prerequisites added; DOC-005 Done; native/game fidelity explicitly unexecuted |
| `docs/guides/database-editing.md` | Core authoring, authors | Templates/spawns, SQL exchange, icons, world tables; DA-02/05 evidence | Complete for bounded source-verified workflow scope; DOC-004 Done; native/game walkthrough unexecuted |
| `docs/guides/settings-and-data.md` | Settings/privacy/backups, authors | Config, projects, sessions, caches; `internal/config/`, `app_mapfile.go` | Complete for source-verified storage scope; DOC-002 |
| `docs/troubleshooting.md` | Symptoms/reporting, authors | Assets, locks, logs, recovery, Linux; recovery code, `env_linux.go` | Partial overall; DB readiness/partial-write/cache diagnostics source-verified (DOC-005/012 Done); native environment remedies not reproduced |
| `docs/BENILLA.md` | Optional client, authors | Local launcher/session/window source, Cargo/build settings and synthetic Go tests | Sufficient for inspected launch/window policy; Partial overall: sibling build/native login not run |
| `docs/development.md` | Build/check/site, contributors | Makefile, package scripts, Wails config, Pages workflow | Partial: source acquisition/root and dependency sequence explicit after session 8; scripts checked, site built; native builds not run |
| `docs/TESTS.md` | Safe test selection, contributors | Unit/live/probe/CLI; `internal/testclient/`, guards, runner, meldtool | Partial: helper/runner sampled; recipes not all executed |
| `docs/architecture/index.md` | Layer/source map, contributors | Desktop/Go/edit/render/write boundaries; root app and `lib/io/` | Complete for internal extension orientation (DOC-007); deeper subsystem references remain Partial/Unverified |
| `docs/architecture/terrain.md` | Terrain/formats, maintainers | `internal/mapfile/`, `internal/adt/`, `lib/terrain/` | Partial overall: bounded preservation/growth/generation/mask/exchange contracts checked (DOC-006 Done); exhaustive format fidelity unverified |
| `docs/architecture/tools.md` | Input/selection/undo, maintainers | `lib/tools/`, `state/historyCore.ts` | Partial overall: tool/history/path and exchange scope checked; native/interleaved Apply remains unverified |
| `docs/architecture/objects.md` | Models/culling/effects, maintainers | `lib/world/`, `lib/models/`, `internal/wow/` | Partial: bounded worker/lifetime/LOD/animation contracts checked; full effects/culling/GPU fidelity unverified |
| `docs/architecture/water.md` | Liquids/render/export, maintainers | `lib/water/`, `internal/adt/water.go` | Partial: liquid/selection/watermap scope checked; shader/export native fidelity unverified |
| `docs/architecture/lighting.md` | Sky/shadows/client lights, maintainers | `lib/engine/`, `lib/world/`, `vmangos/lights.go` | Partial: fallback/client-light/weather/shadow limits checked; actual shader/native frames unverified |
| `docs/architecture/ui.md` | Layout/panels/preferences, maintainers | Components, `lib/ui/`, `lib/state/` | Partial: bounded Check Map lifecycle/focus/fix contracts checked; exhaustive panel/accessibility/native behavior unverified |
| `docs/architecture/client.md` | Assets/spawns/table editors, maintainers | Asset/DB bridge, shared editor/SQL and item persistence | Partial overall; shared editor/SQL sufficient; F-011 Linux queue correction implemented (DOC-005); author guide DOC-004/012 Done |
| `docs/architecture/scripting.md` | Lua runtime/API, script authors/maintainers | `lib/script/`, `internal/scripts/` | Complete for reconciled units/libraries/returned-error/brush/storage and selected example scope (DOC-008); native exceptions/compatibility remain unverified |
| `docs/tests/terrain.md` | Terrain regression, contributors | Frontend tests/probes, ADT tests | Unverified: intro/index only, not run; DOC-009 |
| `docs/tests/tools.md` | Tool/placement regression, contributors | Tool tests/probes | Unverified: intro/index only, not run; DOC-009 |
| `docs/tests/rendering.md` | Shader/model regression, contributors | World/engine probes, browser harness | Unverified: intro/index only, not run; DOC-009 |
| `docs/tests/ui.md` | UI/session regression, contributors | Components, session/prefs probes | Unverified: intro/index only, not run; DOC-009 |
| `docs/tests/spawns.md` | Database/spawn regression, contributors | Shared-frame and item recipe compared with tests/probe source | Partial: F-010 corrected, saved-only probe versus backend refusal evidence separated (DOC-009); remaining live recipes Unverified |
| `docs/tests/client.md` | Export/game regression, contributors | Cache, launch/window, icon IO and patch/extractor source/tests compared | Partial; F-014/015 restart/staging/config corrections implemented (DOC-005/009); remaining live recipes Unverified |
| `docs/tests/scripting.md` | Lua regression, contributors | Script tests, Lua/brush probes | Partial; source/32 synthetic Lua tests and two examples checked (DOC-008); native probes unexecuted |
| `docs/reference/index.md` | Historical-note orientation, maintainers | Scope warnings and notebook links | Complete for historical-orientation scope |
| `docs/reference/testing-notes.md` | CLI/probe/performance research, maintainers | Meldtool, runner, preference history | Unverified overall; old all-preferences-write wording is historical |
| `docs/reference/editor-notes.md` | Earlier feature inventory, maintainers | Tools, menus, settings, editors | Unverified historical material; not a second manual |
| `docs/reference/benilla-notes.md` | Integration history, maintainers | Launcher/game and external observations | Unverified historical material; current setup in BENILLA |
| `docs/DESIGN.md` | Owner-controlled design, maintainers | Lua non-goal contradicts implemented/approved scripting | Outdated in that section; DOC-010 Deferred |
| `frontend/tests/browser/README.md` | WebGL harness, contributors | Browser HTML, Bun test paths | Partial: paths and pure tests checked, isolation/software-GPU caveats added (DOC-009); browser commands unexecuted |
| `build/README.md` | Asset customization, contributors | Tracked manifests/icons/installer assets | Complete for asset orientation after DOC-003 |
| `THIRD_PARTY_NOTICES.md` | Attribution/licences, distributors | Port notices, generated libraries, notices script | Unverified legal/package completeness; retain generator ownership |
| `CLAUDE.md` | Engineering/agent conventions | Local paths, checks, architecture, issues | Unverified overall; not user setup or this roadmap |
| `.claude/issue-loop.md` | Operational instructions, agents | Issue automation/templates | Unverified operations; no automation change requested |
| Three root `DOCUMENTATION_*.md` files | Roadmap/evidence/standards, agents | Current inventory, findings, stable tasks | Complete for initial management scope; DOC-001 |

**Overlap policy:** short feature descriptions belong in the manual, task walkthroughs in one
canonical guide, constraints in architecture, reproducible checks in tests and dated evidence in
notebooks. Existing overlap is not a reason to rewrite thousands of reference lines.

## 3. Coverage matrix

| Subsystem / feature | Existing coverage | State / next work |
| --- | --- | --- |
| Install, build, packaging, Pages deployment | README, development, build assets | Partial; install/uninstall precautions source-verified; native/distributor verification Blocked under DOC-011 |
| Settings, folders, projects, credentials, session/cache | Getting started, settings/data, troubleshooting | Complete for storage/privacy scope; DOC-002 Done; exhaustive key list Not needed |
| Core editing, camera, tools, hotkeys, undo | Manual, tools/UI references | Complete for bounded source-verified orientation, including Check Map; exhaustive native input/undo fidelity Unverified |
| Terrain generation, paint, holes, zones, water, paths | Manual, terrain/water references/tests | Complete for DOC-006 generation/mask/liquid/exchange scope; full format/native round trips remain Unverified |
| Models/WMO, effects, collision, rendering/lighting | Manual, objects/lighting/terrain/water references and rendering checks | Broadly Audited S06; source-verified author orientation Complete, selected lifecycle/LOD/preview contracts reconciled; GPU/game fidelity Unverified |
| WMAP v1–7, MPQ/ADT/DBC/BLP/M2/WMO, binary handoff | Architecture, source/tests, meldtool | Broad initial read/migration, archive and parser-entry inspection; deep compatibility Unverified; DOC-005/006 |
| Region compile, new-world publish, extraction, recovery | Save/compile guide, troubleshooting, client checks | Complete for bounded source-verified write/recovery instructions, DOC-005 Done; native compatibility still Unverified |
| Creatures, objects, quests, items, spells, related tables, SQL | Authoring guide, diagnostics, architecture/regression pages | Broadly Audited; bounded author workflow/readiness/persistence scope Complete (DOC-004/012), native/live behavior Unverified |
| Lua scripts, script brushes, image/noise API | Manual, scripting reference/checks | Reconciled supported API/limits and selected examples (DOC-008 Done); broad compatibility/native exception behavior Unverified |
| Bridge, asset endpoints, Tool/History/Lua extension points | Architecture overview/subsystems | Complete for internal extension orientation (DOC-007 Done), not a public plugin SDK or every backend method |
| Unit/integration/fuzz/browser/probe/performance testing | Testing guide and seven check pages | Partial; known recipe mismatches corrected and focused checks linked (DOC-009 Done); other recipes/native execution Unverified |
| Launch/Play Here and optional Benilla launcher | Compile, troubleshooting, Benilla guides | Sufficient core launch/SOAP prerequisites; backend session/window/launcher seams inspected; camera/probe reconciliation and native/sibling builds remain; DOC-005/011 |
| Troubleshooting, recovery, logs, missing assets, locks | Troubleshooting and settings/data | Partial overall; source-verified storage complete; DOC-002 Done |
| Licences and design decisions | Notices, DESIGN, notebooks/issue provenance | Unverified legal completeness; verified Lua drift DOC-010 |

This table describes **documentation**, not audit completeness. All S01–S14 have broad audit
coverage; source samples, feature inventories, doc references and open questions are in the audit
session-4 record. F-016/017 author-facing gaps are resolved in session 7; native image/list/prefab
round trips remain unexecuted. A menu listing is not a workflow, and a broad audit never makes an
entire reference/subsystem Complete.

## 4. Missing documentation opportunities

Session 6 closed the highest-impact missing authoring/readiness/write-contract guidance under
DOC-004/012/005 and completed the contributor, Lua and bounded regression corrections under
DOC-007/008/009. F-003/007–015/018–019 now have practical source-backed instructions or explicit
limitations. No duplicated controller/API pages or extra tasks were created.

Remaining opportunities are specific, not a new repository audit:

- **Editing/rendering/exchange:** DOC-006 source-verifiable slices are complete. Native dialogs,
  worker/GPU and preview/game fidelity still need representative assets and an authorized isolated
  session; these evidence limits are not a reason to invent more reference pages.
- **Distribution:** DOC-011/F-020 warnings are implemented; native installer/Linux runtime and
  optional Rust/sibling artifact/provenance/attribution remain external verification requirements.
- **Lifecycle/probe edge cases:** DA-06 retains startup/restore/shutdown, unexpected host exceptions
  and runner cleanup/guard questions; selected Lua examples no longer block writing current docs.
- **Policy:** DOC-010 remains owner-controlled and Deferred; DESIGN was not changed.

## 5. Prioritized documentation backlog

No verified P0 gap exists in the inspected scope, and **no P0/P1 task remains open**. All Ready P1
work was implemented in the requested order. Keep task acceptance/history below; a Done task's scope
is bounded and does not certify native/game behavior or complete a whole subsystem. DOC-011 is the
only remaining P2 task and is externally Blocked; no Ready implementation task remains.

### P0/P1 documentation readiness — session 6

Readiness remains independent of implementation status and audit depth. All five P1 tasks are Done;
advanced unresolved questions below do not reopen their bounded acceptance.

| Task | Readiness / status | Evidence / limits |
| --- | --- | --- |
| DOC-005 / P1 Done | Ready; implemented | DA-01/WR/DB evidence used for save/compile/publish/recovery corrections; five synthetic Go tests, build and links passed. Native extractor/client fidelity unexecuted and stated. |
| DOC-012 / P1 Done | Ready; implemented | DB-01 diagnostics, configuration/startup/PATH prerequisites and onboarding links; two Go tests, build and links passed. No live service/setup verification. |
| DOC-004 / P1 Done | Ready; implemented | DA-02/05 authoring/ownership/import/export/client-table evidence in the new guide and navigation; nine Go tests, build and links passed. Native UI/game/concurrent-write/MyISAM rollback not promised. |
| DOC-001 / P1 Done | Ready; already implemented | Historical management acceptance retained; maintain it, do not reimplement. |
| DOC-002 / P1 Done | Ready; already implemented | Historical privacy/storage acceptance retained; recovery evidence reinforces, not reopens it. |

All task IDs and investigation history remain stable. Session-6 audit records actual tests, link
checks and changed-file preservation; session-5 counts are historical, not counted again.

### DOC-004 — Guide database and client-table authoring

- **Priority / status:** P1 / Done, 2026-10-28 (session 6). **Audience:** map/server authors.
- **Completion evidence:** canonical authoring guide, manual/onboarding/sidebar links and per-family safety boundaries implemented; nine synthetic Go tests, site build and 26 local links/anchors passed. See session-6 audit.
- **Description:** teach representative creature/object, quest, item and spell tasks with clear
  persistence/import/export/game-refresh boundaries; avoid a separate page for every picker. F-003.
- **Sources:** `frontend/src/components/{Creature,Object,Quest,Item,Spell}Editor.svelte`,
  `frontend/src/lib/ui/templateIo.ts`, `app_editors.go`, `app_items.go`, `app_spells.go`,
  `app_spawns.go`, `internal/vmangos/{templates,quests,items,spells,sqlscript}.go`, `internal/game/cache.go`.
  Item/spell refinements also use `internal/vmangos/{icons,itemlooks,equipbonus,itemsets,spelllooks,spellstarters,spelltables}.go`,
  `app_icons.go` and `frontend/src/components/{IconGrid,ItemLookPicker,EquipBonuses}.svelte`.
- **Target:** `docs/guides/database-editing.md` (new), manual and sidebar links.
- **Acceptance:** source-verify setup, permissions/platform, template vs spawn, saved vs unsaved
  SQL export, import preview/confirmation, DB vs patch writes, backups, ID conflicts, cache/reload
  requirements and failure recovery; include a minimal workflow per editor family, link relevant
  checks and build the site. Label unexecuted live checks; do not operate a real database for prose.
  Specifically explain target-table filtering, skipped DELETE/UPDATE statements, destination schema
  order/defaults and REPLACE vs merge, unknown columns, plan vs final validation and reread files,
  per-patch/build export and absent item display/icon payloads (F-008). Distinguish UI Revert from
  DB undo; creation persists immediately, and display writes can precede failed item SQL saves;
  transaction framing is not a universal rollback guarantee (F-009).
  Explain icon PNG constraints, stock-name refusal, Meld-icon replacement, partial batch results
  and overwriting PNG exports; importing icons persists immediately even if the parent editor is
  cancelled (F-012). Explain read-only item-set metadata and passive equip bonuses without
  implying a set/spell editor there. Spell SQL carries icon paths/visual rows, not custom BLP bytes;
  missing/broken metadata keeps numeric IDs, and stock nested effect/sound IDs remain assumptions.
  Include the creature wizard and independent Spells/Shop/Quests/Messages saves; object shared
  loot/display sounds; quest row/giver/delete planning; spawn routes/formations/pools and read-only
  script inspection. Map Zones/weather/sounds, Lights, Portals, Flight Paths, World Map and new
  ground effects to patch/DB/server-copy destinations (F-018). Distinguish dialog Apply, parent
  Save, immediate writes and map undo. Verify per-family partial failures before promising recovery.
- **Dependencies / readiness:** Ready after DA-02/05 and reused DB core evidence. Incorporate
  F-019 quest-delete limits and session-5 F-018 ownership/destination/wizard/spawn refinements.
  Explain immediate EquipmentFor writes, non-atomic wizard creation/update, formation effects
  outside the region, shared pool settings and GUID precheck limits. Reuse DOC-012 diagnostics
  and DOC-005 partial-write/recovery guidance; label native execution unverified.

### DOC-005 — Verify save, compile, publish and recovery contracts

- **Priority / status:** P1 / Done, 2026-10-28 (session 6). **Audience:** authors and maintainers.
- **Completion evidence:** guide/troubleshooting/platform/extractor corrections implemented; five synthetic Go tests, site build and 10 local links/anchors passed. See session-6 audit.
- **Description:** finish the high-risk source/test audit underlying existing instructions; correct
  confirmed gaps rather than creating a parallel guide.
- **Sources:** `frontend/src/lib/io/{mapio,compile,publish,vmangosExport}.ts`, `app_region.go`,
  `app_pending.go`, `app_saves_test.go`, `internal/vmangos/{install,pending,publish,export,mmaps}.go`
  and tests, `internal/mapfile/`, `internal/game/`, `docs/tests/client.md`.
- **Target:** `docs/guides/saving-and-compiling.md`, `docs/troubleshooting.md`,
  `docs/architecture/client.md`, `DOCUMENTATION_AUDIT.md` and this coverage matrix.
- **Acceptance:** trace region vs new-world saves, client/server/SQL writes, platform gates,
  pending persistence, backup limits, cancellation/failure behavior, old-format unknown-data
  preservation and launch separation using source/test assertions; reconcile relevant recipes;
  record unexecuted real-client checks; build the site.
  Resolve F-011 explicitly: compare App.gameRunning/queueClientFiles with OSRunner process
  detection before claiming Linux waits for the game. Distinguish queued/installed client DBCs
  from later SQL failure and explain limits of patch-only rollback (F-009).
  Add audience-appropriate cache-refresh recovery without duplicating the correct developer
  recipe: stale IDs are memory-only, cache-pruning failures log and do not stop launch (F-013).
  Reconcile the stale extraction/game-restart statements (F-014), distinguish staged extractor
  failure protection from later non-atomic file replacement, and explain optional movement-map
  generation failures and untouched mmap.enabled settings (F-015). Cross-link immediate icon IO
  writes, patch backups and DB/client dual-write limits; do not imply Cancel undoes an import.
- **Dependencies / readiness:** Ready after DA-01 and reused WR-01/02/03, item/spell dual-write and
  session-5 recovery evidence. Unknown native compatibility is an explicit documentation limitation,
  not a blocker for correcting F-011/014/015. Describe legacy holes/liquids/headers as unknown-data
  preservation, border-tile writes and client-before-spawn failure boundaries; never promise atomic
  publish or database rollback. Implemented under session-6 authorization; historical audit-only limits retained.

### DOC-012 — Document database readiness and connection diagnostics

- **Priority / status:** P1 / Done, 2026-10-28 (session 6). **Audience:** authors and contributors using database features.
- **Completion evidence:** canonical diagnostics and onboarding link implemented; config/connectivity tests, site build and local links/anchors passed. Native service setup remains explicitly unexecuted.
- **Description:** document the verified hidden prerequisites and diagnostic branches from DB-01,
  F-007, without duplicating the future authoring walkthrough or confusing SQL reads with Windows
  map-extractor support. Query/export/preview can start the local database; no Save is required.
- **Sources:** `internal/vmangos/publish.go:worldDB/confDatabase`,
  `internal/vmangos/spawns.go:runSQL/mariadbError`, `internal/vmangos/dbstart.go`,
  `internal/vmangos/spawnedit.go:runScript`, `internal/vmangos/templates.go:openWorld`,
  `app.go:serverAndData`, `internal/vmangos/helpers_test.go:TestConfDatabase/TestCantConnect`.
- **Target:** one canonical database section in `docs/troubleshooting.md`; short prerequisite/link
  additions in `docs/getting-started.md` and the eventual `docs/guides/database-editing.md`.
- **Acceptance:** explain the executable named mariadb on PATH, configured server/client folders,
  connection fields in run/mangosd.conf and their distinction from Game Login; diagnose missing
  CLI/config, authentication failure and stopped service separately; state the read-triggered
  Windows-only startup prerequisites (database/my.ini, adjacent daemon, retry timeout), manual Linux
  service requirement and why mysql-only discovery is not a query-client substitute. Use redacted
  placeholders, not credentials or a generic privilege grant; distinguish static evidence from
  unexecuted native setup and link the existing log/backup guidance. Build/link-check the site.
- **Dependencies / readiness:** Ready. DB-01 is finished and DB-04 client gating was already reviewed.
  Reuse that evidence; do not restart DB-01. Implemented under session-6 authorization.

### DOC-006 — Audit editing and rendering references in slices

- **Priority / status:** P2 / Done, 2026-10-28 (session 7). **Audience:** authors and contributors.
- **Completion evidence:** session-6 world-view/nav/growth/height/path guidance retained. Session 7
  traces generation/tile-mask/paint-mask/area/liquid scope, image/list/brush/set exchange, Check Map
  focus/fixes/skips and model workers/lifetime/LOD/animation/light/weather/streaming limits into
  existing manual and six architecture pages. 91 focused Bun tests, site build and local links/anchors
  pass, plus eight synthetic Go image-codec tests; audit records exact symbols and remaining native
  limits. No GPU/game/native fidelity claim.
- **Description:** reconcile terrain/tools/water, then models/lighting/UI; record each completed
  slice instead of treating directory discovery as full review.
- **Sources:** `frontend/src/lib/{terrain,tools,water,world,models,engine,state,ui}/`,
  `internal/adt/`, `internal/wow/`, corresponding tests/probes.
- **Target:** existing `docs/architecture/{terrain,tools,water,objects,lighting,ui}.md` and audit.
- **Breadth-pass refinement:** also target focused sections/links in `docs/MANUAL.md` and
  `docs/getting-started.md`, not another architecture manual. F-016 covers World View/Edit Here,
  walk/collision, preview versus server mmaps, Test a Path, client lighting and display/performance
  choices. F-017 covers generation/heightmap start, growth guards and image/list/brush/set/prefab
  exchange units, scope and persistence. Sources include `lib/io/{images,heightmapImport,lists,
  prefabFiles,regionGrow,worldGrow}.ts` and the corresponding dialogs.
- **Acceptance:** per slice record files/symbols/tests; verify important invariants, fix drift,
  list remaining contracts, synchronize coverage and build changed pages; avoid exhaustive internals.
- **Dependencies:** None; preserve source-current lake-beach notes from `c8d5eeb`.

### DOC-007 — Clarify contributor extension boundaries

- **Priority / status:** P2 / Done, 2026-10-28 (session 6). **Audience:** feature contributors.
- **Completion evidence:** contributor checklist verified against Sculpt/History/commands and region alpha handoff; 101 Bun tests, TestServeOnce, site build and local links passed. No bindings regenerated or native behavior certified.
- **Description:** orient additions to tools, Go bindings and Lua capabilities, not a public SDK.
  DB-02 confirmed shared TemplateEditor internals already have sufficient architecture/test coverage;
  link that explanation instead of expanding this task into another helper reference.
- **Sources:** `frontend/src/lib/tools/Tool.ts`, `frontend/src/lib/state/historyCore.ts`,
  `frontend/src/lib/ui/{tools,commands}.ts`, `frontend/src/lib/script/{scriptApi,prelude}.ts`,
  `main.go`, `app.go`, `frontend/wailsjs/`, Makefile bindings, `internal/handoff/handoff.go`.
- **Target:** `docs/architecture/index.md` linking existing references.
- **Acceptance:** locate registration/dispatch, undo, keys/preferences, generated bindings, binary
  transfer and smallest tests; verify against an existing feature; distinguish internal contracts
  from user scripting; build the site.
- **Dependencies:** None; reuse DOC-006/008 findings when available.

### DOC-008 — Reconcile Lua examples and API limits

- **Priority / status:** P2 / Done, 2026-10-28 (session 6). **Audience:** script authors.
- **Completion evidence:** manual unsupported-feature mismatch corrected; units/libraries/returned-error/brush/storage limits reconciled; two documented examples executed on fake host, 32 Bun and three Go tests passed, site build and local links passed. Native cancellation remains explicitly unverified under DA-06.
- **Description:** audit existing manual/reference examples before adding any; keep canonical API prose.
- **Sources:** `frontend/src/lib/script/`, `frontend/src/lib/engine/ScriptRun.ts`,
  `internal/scripts/`, frontend Lua tests, `frontend/probes/{lua-script,script-brush}.js`.
- **Target:** `docs/MANUAL.md`, `docs/architecture/scripting.md`, `docs/tests/scripting.md`.
- **Acceptance:** verify units, partial-error undo, timeout/libraries, map/world restrictions,
  storage and brush events; validate minimal existing/revised examples against source/tests,
  record whether examples ran and build the site.
  Reconcile Engine.runScript finishing one undo command after returned errors with retained brush
  events, cancellation and chunk/liquid/palette edits. Existing API prose is substantial; do not
  create another API dump. Broad source sampling did not run examples.
- **Dependencies:** None; DESIGN policy change remains DOC-010.

### DOC-009 — Validate regression and troubleshooting references

- **Priority / status:** P2 / Done, 2026-10-28 (session 6). **Audience:** contributors/support maintainers.
- **Completion evidence:** F-010/014/015 reconciled; selected recipe-to-symbol paths and runner options checked; 47 Bun tests and one Go range-refusal test passed, site build and 21 local links/anchors passed. Full live recipes/native platforms remain unexecuted.
- **Description:** check recipe-to-test paths, anchors, environment assumptions and unsafe examples,
  not a blanket live-probe run or historical notebook rewrite.
- **Sources:** `frontend/probes/`, `frontend/tests/browser/`, `internal/testclient/`,
  `guard_test.go`, `cmd/meldtool/`, `env_linux.go` and relevant tests.
- **Target:** `docs/TESTS.md`, `docs/tests/*.md`, `frontend/tests/browser/README.md`,
  `docs/troubleshooting.md`;
  notebook links/warnings only where necessary.
- **Acceptance:** map checked recipes to existing symbols, repair stale paths/unsafe examples,
  record remaining recipes/platforms, verify links/anchors; preserve `--shot <dir>`; build the site.
  Correct the verified item-refusal/tab-jump mismatch (F-010) and failed-extraction restart claim
  (F-014); distinguish machine-specific mmap.enabled observations from configuration changes.
  Correct F-010's item-editor claim: the probe enters an invalid level but never saves; backend
  validation and shared refusal callbacks are separate unit-test evidence, not a live tab-jump check.
  Preserve pure rules versus standalone WebGL pages versus backend-sharing probes and real-GPU
  measurements. Broad sampling does not verify every recipe or the guards through arbitrary helpers.
- **Dependencies:** None; prioritize write recipes through DOC-004/005.

### DOC-011 — Verify supported build and packaging instructions

- **Priority / status:** P2 / Blocked after source-backed precautions, 2026-10-28 (session 6). **Audience:** contributors/distributors.
- **Completed slice / exact blockers:** F-020 install-folder deletion warning, scope/WebView2/association limits and npm/Go versus sibling-Rust distribution boundary documented. Session 7 adds the disposable-host matrix and distributor decision checklist in development.md. Still needs disposable native Windows installer and Linux WebKitGTK hosts plus distributor-supplied launcher artifact/revision/assets/attribution decisions; no runtime packaging certification.
- **Description:** finish native setup/packaging verification without expanding supported platforms.
- **Sources:** `Makefile`, `go.mod`, `wails.json`, `build/windows/installer/`,
  frontend package scripts, Pages workflow, `benilla-launcher/`.
- **Target:** `docs/development.md`, `build/README.md`, `docs/BENILLA.md` and audit.
- **Acceptance:** record Windows/Linux evidence separately; inspect NSIS and optional launcher
  requirements, document supported artifacts/confirmed gaps, distinguish docs deployment from app
  distribution; do not invent release or macOS support; record unavailable environments.
  Reconcile NSIS install scope, WebView2, associations/uninstall effects, generated bindings and
  notices-check npm/Go closure with the optional sibling-built Rust launcher. Separate Rust
  attribution is an open distributor-review question, not a verified licence defect. Include F-020:
  the NSIS uninstall recursively removes the chosen installation directory; do not place author
  data there. Separate this source-verified effect from unexecuted installer behavior.
- **Dependencies:** None; native validation may require another platform/session.

## 6. Work currently in progress

None. No task lease, delegate or background job remains. Initial source-verifiable implementation
and whole-documentation quality review are complete; DOC-006 joins the Done tasks. DOC-011 is
Blocked and DOC-010 Deferred. No P0/P1 remains. Session 9 adds the verified P2 theme follow-up
DOC-013; completed source-writing tasks are not reopened.

### DOC-013 — Resolve verified documentation-theme accessibility issues

- **Priority / status / readiness:** P2 / Todo / Ready. **Audience:** keyboard and assistive-technology users.
- **Description:** address F-023 from the existing live VitePress site, without changing editor behavior.
- **Sources:** `docs/.vitepress/config.mts`, `frontend/package.json` (VitePress 1.6.4), default-theme
  `VPHome.vue`, `VPSidebarItem.vue`, `VPLocalSearchBox.vue` and theme CSS in installed VitePress.
  These are runtime findings; no upstream source audit or proposed fix is credited yet.
- **Target:** minimal documentation-theme configuration/override if needed, this plan and the audit.
- **Acceptance:** correct code-language and brand-button contrast; resolve nested interactive
  sidebar/search controls; give the homepage a main landmark. Recheck axe WCAG AA/best-practice
  findings, keyboard focus, search selection/closure and mobile menus against the deployed commit.
  Investigate axe's incomplete search contrast result manually; do not equate zero automated
  violations with full screen-reader certification.
- **Dependencies:** a focused theme fix and authorized publication, followed by live browser retest.

### Publication and CI handoff — session 9

- Existing `.github/workflows/docs.yml` now validates relevant pull requests and `main` pushes
  using `cd frontend; bun run docs:check`. PRs cannot upload/deploy Pages; `main` retains the
  existing Pages artifact/deploy architecture. Dependencies use a frozen lockfile and Bun cache.
- Local build, Markdown/rendered links/anchors/navigation/assets, checker failure tests and
  actionlint passed. A successful older remote Docs run is historical, not evidence for this change.
- After explicit push authorization, push the dedicated commit without force, observe its Docs
  build/deploy jobs, compare live `revision.txt` with its head SHA, and retest the new guides and
  updated pages. Never dispatch an old remote revision as a substitute for publishing this commit.
- Integration prerequisite: remote `main` was 20 commits ahead of the source baseline at session
  start, with overlapping documentation edits. Preserve both sides in a history-preserving merge
  and revalidate affected claims before pushing; no merge, rebase or reset occurred in this session.

**Prioritized maintenance queue (resource/event triggered, not autonomous recurring work):**

1. **Before distribution — DOC-011 P2:** distributor supplies the exact artifact/architecture,
   scope, launcher/sibling revision/assets and attribution decisions; a tester supplies disposable
   native Windows and Linux hosts. Execute the existing
   [packaging matrix](docs/development.md#disposable-host-verification-still-required), preserve
   logs/artifact hashes and update only claims actually demonstrated. No destructive local tests.
2. **When a native validation session is authorized — DA-03/04:** exercise first-launch/edit/save,
   image/list dialogs, Check Map focus/fix/Undo, model worker failure/release, representative WMO
   rooms/liquids and a compiled game comparison. Include site hydration/search/navigation QA.
   These are explicit evidence gaps, not unfinished source-writing tasks or fidelity promises.
3. **When a documented contract changes or a reproducible report arrives:** reopen the affected
   stable DOC ID, inspect its caller/helper/test chain and update the canonical guide plus regression
   recipe. Review DA-06 lifecycle/probe edge cases only for a concrete claim or failure. Split long
   references only if users cannot find a real task; do not manufacture page/field inventories.
4. **Only with owner approval — DOC-010 P3:** reconcile the historical Lua non-goal in DESIGN.
   Until then retain the draft/historical label and current scripting guide links.

Preserve preexisting changes, authoring/settings guides and operator files. Session-7 audit records
current checks and application preservation separately from earlier edits. DOC-013 is justified by
observed accessibility failures, not speculative backlog. Reassess on relevant changes/release
preparation, not a timer or another broad audit.

## 7. Completed documentation tasks

Session 6 (2026-10-28) completed DOC-004, DOC-005, DOC-007, DOC-008, DOC-009 and DOC-012;
full acceptance and completion evidence stay with their stable task entries in section 5 and the audit.
The historical tasks below completed on 2026-10-27 after source verification, site build, local links
and whitespace checks. Retain these records when reopening; append reason/date rather than erasing history.

### DOC-001 — Establish the persistent documentation system

- **Priority / status:** P1 / Done, 2026-10-27. **Audience:** maintainers/independent agents.
- **Description:** establish inventory, evidence, priorities and continuation protocol.
- **Sources:** tracked paths, existing docs and source samples listed in the audit.
- **Target:** `DOCUMENTATION_PLAN.md`, `DOCUMENTATION_AUDIT.md`, `DOCUMENTATION_RULES.md`,
  `README.md`, `docs/development.md`.
- **Acceptance satisfied:** all nine sections, required task fields, stable IDs, scope/evidence/unknowns,
  maintenance standards and next-run instructions; entry links/local paths verified.
- **Dependencies:** None.

### DOC-002 — Explain settings, private data and safe backups

- **Priority / status:** P1 / Done, 2026-10-27. **Audience:** authors/support contributors.
- **Description:** close the storage/privacy gap, F-001/F-002.
- **Sources:** `internal/config/{config,project}.go`, `app_project.go`, `app_mapfile.go`,
  `internal/scripts/scripts.go`, `internal/vmangos/pending.go`,
  `frontend/src/lib/{state/prefs.ts,io/session.ts,io/recovery.ts}`.
- **Target:** `docs/guides/settings-and-data.md`, sidebar, setup/troubleshooting/Benilla links.
- **Acceptance satisfied:** source-verified categories, OS/XDG paths, plaintext warning, project portability,
  session vs recovery, non-disposable pending/cache data and backup boundaries; links/site build
  pass. No exhaustive option catalog or promised cross-machine migration.
- **Dependencies:** None.

### DOC-003 — Replace unsafe build-directory boilerplate

- **Priority / status:** P2 / Done, 2026-10-27. **Audience:** packaging contributors.
- **Description:** remove reset-by-deletion advice, clarify supported platforms, F-004.
- **Sources:** Makefile, tracked `build/windows/*`, `build/darwin/*`, Wails config.
- **Target:** `build/README.md`.
- **Acceptance satisfied:** distinguishes generated outputs/tracked assets, links canonical builds, identifies
  Windows installer assets and retained macOS templates; no destructive reset advice/support claim.
- **Dependencies:** None.

## 8. Deferred and intentionally excluded topics

### DOC-010 — Reconcile the owner-controlled Lua design non-goal

- **Priority / status:** P3 / Deferred. **Audience:** maintainers reading design policy.
- **Description:** DESIGN still calls Lua a non-goal despite implemented/approved scripting, F-005.
- **Sources:** `docs/DESIGN.md`, `docs/architecture/scripting.md`, `frontend/src/lib/script/`.
- **Target:** `docs/DESIGN.md`.
- **Acceptance:** with owner approval, amend obsolete non-goal while preserving provenance;
  check guide links. **Dependencies:** explicit owner approval required by DESIGN.
- **Reason:** already labeled draft/historical by the reference index; do not silently rewrite policy.

Intentionally excluded, not actionable backlog:

| Topic | Why not now | Reconsider when |
| --- | --- | --- |
| Every preference key, trivial helper or renderer field | High churn, low reader value | Specific recurring confusion demonstrates a gap |
| Full third-party tutorials/legal certification | Upstream duplication; notices have a generator | A concrete integration/licence discrepancy appears |
| Another manual/API dump/notebook rewrite | Duplicates canonical structure | A task cannot be served by current pages |
| macOS/later WoW formats | Unsupported targets | Owner changes scope |
| Speculative plugin/collaboration/release APIs | No verified stable feature contract | Implemented feature/audience exists |
| Decorative screenshots/exhaustive visual baselines | Maintenance/privacy cost exceeds value | A specific workflow needs a visual |
| Blanket live probes or database writes | Shared-state/data risk; not docs validation | Coordinated isolated integration testing is needed |
| Untracked operator files, scratch, dependencies, build/cache output | Not maintained product content | Explicit scope or tracked-code dependency requires inspection |

## 9. Prioritized deep-audit follow-ups

Historically, session 5 authorized targeted deep audits, not guide implementation. The session-4 breadth
inventory and all stable DA IDs remain. Risk ordering moves DA-05 ahead of rendering because its
DB/client write and shared-reference questions affect DOC-004 P1. DA-06 recovery safety precedes
advanced exchange/rendering work. No completed WR/DB core review is repeated without a specific question.

| Unit / execution priority | Current investigation status | Answered scope / concrete continuation |
| --- | --- | --- |
| DA-01 / 1 | Complete: bounded write/preservation questions resolved | ExportMap/BuildRegion, optional legacy data, borders/UIDs and frontend client/spawn/server ordering reconciled with tests and current guide/recipes. DOC-005 Done in session 6. Real-client compatibility, power-loss behavior and external extractor fidelity remain explicitly unverified, not promised. See session-5 evidence. |
| DA-02 / 2 | Complete: documentation-critical authoring questions resolved | Independent saves, shared spell/gossip versus explicit loot copies, quest delete and client-table destinations resolved; final wizard/topology review closes pre-Make gear writes, template-first failure, route replacement, outside-region formations/shared pools, GUID precheck and best-effort SQL-log limits. Synthetic tests pass; native/live DB/UI and concurrent-write fidelity remain explicitly unverified. DOC-004 Done in session 6; no exhaustive SQL-engine or every-tab certification. |
| DA-05 / 3 | Complete: reference/visual-save questions resolved | Object/quest table requirements, lock/page/language lookup and failure caching, composer Apply versus Save, append/reuse visual/kit behavior, DB-first spell save and source/probe limits reconciled. Pure tests pass. Direct refNames batching/cache tests were not found; actual effect/sound/missile rendering belongs to DA-03 and game compatibility is unexecuted. This closure does not promote the entire DB-08 family to Fully inspected. |
| DA-06 / 4 | Partially complete; safety subset resolved | Recovery timing, multipart/discard/clean-quit paths and Lua error/brush undo behavior checked with focused tests/source/recipes. Remaining: full startup/restore and shutdown-failure matrix, log error handling, broad prelude compatibility and runner guard/timeout/sandbox cleanup contracts (selected examples checked under DOC-008 in session 6). No blanket probes; review specific failing/refused cases before executing a disposable harness. DOC-005/008 Done is not full lifecycle certification. |
| DA-04 / 5 | Complete for bounded source documentation; native exchange verification unexecuted | Prior migration/growth/height/prefab/path evidence retained. Session 7 resolves generator seed/scope, tile/paint/area/liquid distinctions, image/list/brush/set and Check Map focus/fix/skip contracts; DOC-006 Done. Native file-dialog round trips and interleaved path Apply remain explicit runtime limits, not unread-source blockers. No exhaustive exchange certification. |
| DA-03 / 6 | Complete for bounded source documentation; native fidelity verification Blocked | Prior nav/WMO evidence retained; session 7 traces model worker fallback/job errors, shared resource lifetime, LOD/animation and lighting/weather/streaming/shader limits. DOC-006 Done, not full renderer inspection. Worker failure on a real WebView/GPU, WMO floors/rooms and preview/game parity require authorized native assets/session and coordinated game comparison. GAME-04 and native recipes remain unverified. |
| DA-07 / 7 | Partially complete; native/distribution closure Blocked | NSIS install scope/WebView2/file/association/uninstall paths, Makefile, notices generator npm/Go scope and sibling Rust manifest/buildstamp compared with build docs. F-020 precautions implemented in session 6. Remaining: Windows installer and Linux WebKitGTK install/runtime checks on disposable native hosts; exact optional launcher artifact, sibling revision/assets and Rust attribution boundary need distributor input. No guessed release/macOS support or legal certification; DOC-011, DOC-010 stays owner-approved only. |

Complete here means the named documentation questions have answers or an explicit unresolved
classification, not exhaustive review or live compatibility. Partial units retain their unread
boundaries; filenames/probe listings are not evidence of execution. Reuse preservation evidence
across DA-01/04 and visual-rendering limits across DA-05/03 rather than opening duplicate units.

**Next bounded investigations:** no source-writing investigation remains required by DOC-006;
DA-06 lifecycle/guard checks when needed for a concrete correction. DA-02 wizard/topology and
DA-01 write/recovery questions are resolved; do not repeat them. Schedule native DA-03 work only
with assets/session authorization and DA-07 only with native hosts/distributor input. DOC-011 remains
Blocked on those resources; its safety prose is implemented. DOC-010 stays Deferred.

Sessions 6 and 7 implemented the Ready core, contributor/Lua/regression and remaining source-backed
editing/rendering guidance independently of external uncertainties. Compare future commits and
working changes against the recorded revision, preserve the canonical guide/reference split and
retain all preexisting work. Section 6 is now a maintenance queue, not an implementation handoff.
No commits, branches, application-source changes or live operations were made.
