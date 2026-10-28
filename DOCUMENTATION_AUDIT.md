# Documentation audit log

## Latest audit

- **Current handoff:** 2026-10-28, session 10, focused DOC-013 accessibility/usability corrections.
  See [session-10 evidence](#documentation-accessibility-and-usability-2026-10-28-session-10).
  Local theme fixes, regression tests and browser validation are complete; DOC-013 is **In progress,
  awaiting deployed-revision retest**, not Done, because deployed-revision acceptance remains.
  This session read live `revision.txt` as `a9643c7ec05345d273708c7d34c5e5663b5d7eea`, matching
  its starting HEAD. Earlier session-9 remote/publication/404 observations remain historical below.
  The owner authorized committing and pushing these edits on 2026-10-29. Completed source-writing
  tasks and native/distributor limitations are unchanged.

### Prior acceptance summary — session 8

- **Date/type:** 2026-10-28, Europe/Stockholm; session 8, documentation-first acceptance review.
- **Source revision:** `0d935acf50662d68c6b46f0381605b3e99c54b6c`; compared changed-path inventory
  against the session-7 baseline (same HEAD); no committed source changes. Existing working changes
  were preserved; session-8 file hashes distinguish this review's corrections.
- **Implemented:** F-021 source-checkout/dependency navigation and WebView2 prerequisite correction;
  F-022 explicit server extractor layout and pre-write readiness instructions. Existing guides
  retained; no new pages or tasks. Documentation passes bounded source-backed acceptance, not
  real-user testing, native onboarding or game certification.
- **Readiness/remaining:** initial actionable creation is complete; maintenance phase. No P0/P1 or
  Ready task remains. DOC-011 Blocked on disposable native hosts/distributor decisions; DOC-010
  Deferred for owner approval. Event-triggered maintenance is in roadmap section 6; no active lease/job.
- **Audit versus docs:** all 14 parents remain Broadly Audited, none promoted to subsystem-wide
  Fully inspected/Deeply Audited. DA-01/02/05 closure reused; DA-03/04/06/07 limits remain. Guides
  distinguish source/synthetic evidence from unexecuted native/game behavior. Dated older statuses
  below are historical; this summary and current roadmap supersede them for implementation progress.
- **Verification:** session-8 site build and Markdown/rendered links/anchors passed; exact results
  and execution limits are recorded below. No application tests were rerun for prose-only changes.
  Session-7 test results remain historical, not new evidence from this review.
- **Change boundary:** only existing Markdown pages and management files intentionally changed.
  Preserve all preexisting tracked doc/navigation edits, untracked guides/operator files and audit
  history. Session-start SHA-256 hashes cover tracked paths. No application-source/generated
  binding/fixture changes, commits or branches; no native app/installer, game/DB/server/extractor,
  probe/browser/GPU session or external licence certification executed.

Use [the roadmap](DOCUMENTATION_PLAN.md) for audiences, coverage/tasks and next work;
[the rules](DOCUMENTATION_RULES.md) define the incremental maintenance protocol.

## Repository areas inspected — initial session

**Reviewed** means the named text/contract was read; **sampled** means selected sections or
declarations; **indexed** means filenames/headings. None implies a whole package audit.

| Area | Depth and exact samples / contracts examined | Still unexplored |
| --- | --- | --- |
| Desktop/bridge | Sampled `main.go` middleware, `app.go` lifecycle/config, `app_project.go` open/close/forget, `app_mapfile.go` recovery/log setup | Other bridge methods, game/table/spawn saves, root-test assertions |
| Config/projects | Reviewed `internal/config/config.go` persistence/migration/login/merge and `project.go` descriptor; sampled `state/prefs.ts`, `io/project.ts`, `io/session.ts` | All defaults/validation and multi-window failure cases |
| Recovery/scripts/logs | Sampled `internal/recovery/recovery.go`, `internal/scripts/scripts.go`, `internal/sessionlog/sessionlog.go`, `io/recovery.ts`, `app_mapfile.go` paths | Cleanup/crash/log-retention tests, script-image IO |
| Formats | Sampled `internal/mapfile/mapfile.go` v7/header, v1–7 fixture filenames; indexed ADT/MPQ/BLP/M2/WMO/DBC sources | Parser/writer internals and compatibility tests, heightmap/images |
| Client/assets | Sampled `internal/wow/client.go` cache path/endpoint registrations, `main.go` routing | Endpoint payload/errors, archive order and decoders |
| Server/writes | Sampled `internal/vmangos/install.go` patch/backup constants, `pending.go` persistence/root, `io/compile.ts`, `internal/game/session.go`, `vmangos/start_other.go` | Full publish/export/extractor/SQL/platform behavior and tests; DOC-004/005 |
| Tools/interfaces | Sampled `lib/tools/Tool.ts`, `state/historyCore.ts`, `ui/commands.ts`, `engine/MapDocument.ts`, `ui/templateIo.ts` | Tool registration, undo cases, render/world implementation |
| Lua | Sampled `lib/script/scriptApi.ts` host/types/limits, scripts package and architecture intro | Full prelude/API, examples and brush tests |
| UI/settings | Read category labels in `components/PreferencesDialog.svelte`; indexed 106 component files/editor names | Individual editor/picker workflows and all menu/default verification |
| Generation | Sampled recent `c8d5eeb` diff, `lib/terrain/beach.ts` declarations and updated architecture note | Full generation/import/paint/water algorithms/tests |
| Testing/CLI | Reviewed testing entry guide; sampled `internal/testclient/testclient.go`, `cmd/meldtool/main.go`, `frontend/probes/run.mjs` arguments/isolation | Guards, all fixtures/probes/browser recipes, live DB tests |
| Build/site | Reviewed Makefile, Go direct requirements, Wails config, frontend package, site config, Pages workflow, build README; sampled launcher Cargo paths and Windows metadata | Installer internals, native setup, other workflows, launcher runtime, notice generation |
| Historical/operations | Read root CLAUDE guidance and DESIGN; indexed issue-loop config/workflows/templates | Remote issue/decision history and operational automation |

Frontend paths abbreviated above start at `frontend/src/` (or `frontend/src/lib/` for
`state/`, `io/`, `ui/`, `engine/`). Backend discovery catalog: `adt`, `config`,
`game`, `handoff`, `heightmap`, `mapfile`, `mpq`, `recovery`, `sandbox`, `scripts`,
`sessionlog`, `testclient`, `vmangos`, `wow`. Handoff and sandbox introductions were sampled,
not their complete transfer/security contracts. Frontend discovery includes bench/check/engine/io/
models/script/state/terrain/tools/ui/water/world/wow, components, tests, scripts, Wails bindings and
probes. Cataloging does not establish accuracy.

## Existing documentation reviewed — initial session

- **Focused text review with source samples:** README, site home, getting started, manual,
  development, save/compile, troubleshooting, Benilla, testing, architecture overview, reference
  index, DESIGN and build README. This establishes specific statements below, not every platform claim.
- **Introductions/headings and selected sections:** eight detailed architecture references, seven
  feature-check pages, three notebooks, browser README. Format version, Lua limits, compile-wait
  notes and historical restart warnings were compared selectively. Full examples/recipes remain unaudited.
- **Inventory only:** full third-party licence/notice texts and issue-loop operations; no legal
  completeness or remote issue-history audit.
- The roadmap holds the exact per-page purposes, audiences, labels and improvement targets rather
  than duplicating that inventory here.

## Verified findings and evidence

### F-001 — Saved credentials lacked a user-facing storage warning

- **Observed:** Benilla instructions recommend Game Login and warn against shell/report exposure,
  but did not explain plaintext password storage. Focused user-guide searches found no equivalent warning.
- **Evidence:** `internal/config/config.go`: `Login.Password` is JSON; `write` serializes the
  config without encryption. `path` uses `os.UserConfigDir()/Meld/config.json`. Filesystem
  permissions are not a credential vault.
- **Impact:** settings/backups may be shared without understanding their contents. P1; no evidence
  that the repository exposes actual credentials.
- **Resolution:** DOC-002 adds canonical plaintext/local-only/redaction guidance and entry links.

### F-002 — Cache directories contain potentially irreplaceable author data

- **Observed:** existing pending/recovery prose lacked a consolidated storage/backup map. Treating
  all cache output as disposable would be unsafe.
- **Evidence:** `app_mapfile.go:startRecovery` uses user cache `Meld/recovery`; `startSessionLog`
  uses `Meld/logs`. `internal/vmangos/pending.go:pendingRoot` uses `Meld/pending-client`
  (temp fallback on lookup failure); `AddPending` retains unflushed client data.
  `internal/wow/client.go:thumbPath` separately stores reproducible thumbnails in `Meld/thumbs`.
- **Related:** `io/session.ts:sessionState` stores saved-file/region/world references and views,
  not untitled edits. `io/recovery.ts:autosave` waits for the configured interval and can be disabled.
  `internal/config/project.go` stores name/client path, not assets.
- **Resolution:** DOC-002 distinguishes references, working files, recovery/pending data, scripts
  and thumbnails; warns against blanket cache deletion and treating session restore as backup.

### F-003 — Database editors lack a consolidated author workflow

- **Observed:** the manual lists creature/object/quest/item/spell editors but does not teach their
  setup, persistence or import/export tasks. Architecture/regression recipes are not safe task guides.
- **Evidence:** corresponding `components/*Editor.svelte` files exist; `lib/ui/templateIo.ts:exportRow`
  warns that export uses saved rows, excluding unsaved changes; `askImport` plans a selected SQL
  script. Backend template/quest/item/spell/SQL sources exist; full handlers are not yet traced.
- **Disposition:** DOC-004 P1 Todo. Do not infer transaction/undo/reload behavior from helper names.
  This is a verified discoverability gap, not a verified product defect.

### F-004 — Build README recommended resetting customized assets by deletion

- **Observed:** generic build boilerplate advised deleting files to regain defaults and discussed
  macOS without a supported-platform qualification.
- **Evidence:** tracked build files include customized icons, manifests, metadata and NSIS scripts;
  Makefile/README target Windows and Linux.
- **Resolution:** DOC-003 P2 distinguishes tracked assets/outputs and removes destructive advice.
  No actual loss of user assets was observed.

### F-005 — Owner-controlled draft retains an obsolete Lua non-goal

- **Evidence:** DESIGN lists Lua as a non-goal; scripting architecture records approval on
  2026-10-25 and the implemented engine; `lib/script/scriptApi.ts` defines the current contract.
- **Disposition:** DOC-010 P3 Deferred; DESIGN explicitly requires owner approval. The reference
  index already warns historical scope is not current functionality. Approval provenance was read
  in repository documentation, not independently fetched from GitHub.

### F-006 — Preserve the recent guide/reference separation

- **Evidence:** `5080b99` introduced task guides and retained notebooks on 2026-10-27. Reference
  introductions warn old restart descriptions are historical. `state/prefs.ts:send` sends changed
  keys; the testing notebook retains earlier all-preferences-write wording.
- **Disposition:** use canonical guides, not old operational descriptions. Repair misleading links/
  warnings under DOC-009 only when needed; do not bulk-rewrite historical investigations.

## Change reconciliation

Recent commits inspected as initial discovery, not a claimed continuation:

- `5080b99`: guide/reference reorganization; preserve canonical destinations.
- `c8d5eeb`: lake beaches; architecture note updated in that commit; behavior not tested here.
- `e8c86e9`: `--shot` requires a folder and rejects a following option. Existing notebook uses
  `--shot <dir>` already, so no new documentation gap was established.

Future sessions compare against the recorded revision and working tree; these recent commits do
not establish coverage of earlier functionality.

## Unresolved questions and deeper investigation

1. Which editor writes combine DB and patch changes, what can partially fail, and which IDs/imports/
   reloads matter per task? DOC-004; shared helper names are insufficient evidence.
2. Do all save/compile/publish guards, cancellation and old-format preservation branches match the
   guide, including platform extractors? DOC-005; selected comments are insufficient.
3. Which deep reference claims, labels and recipes are stale? DOC-006/009; a historical note alone
   does not make a whole current reference Outdated.
4. Are Lua examples accurate for units/errors/undo/brush events? DOC-008.
5. Do Windows/Linux setup, NSIS and sibling Benilla builds work as described? DOC-011; not exercised.
6. Is an owner-approved DESIGN amendment desired? Deferred; do not assume approval.

Roadmap section 9 retains all remaining source/reference/operational/runtime gaps. Generated output,
dependencies, untracked `.agents/` and `_scratch/` are excluded from maintained product content.
No evidence suggests every helper needs a documentation task.

## Work and validation record — 2026-10-27

- Initial implementation: management files (DOC-001), settings/data guide and entry links (DOC-002),
  build-assets correction (DOC-003). No application behavior change.
- Initial priority outcome: no verified P0 in inspected scope; DOC-004/005 are the next P1 work.
  P2 work is bounded verification/reference improvement, not a demand for documentation volume.
- **Passed:** `bun run docs:build` in `frontend/`; VitePress rendered all pages. The build emitted
  a non-failing bundle-size warning (chunks over 500 kB); no unrelated bundling changes were made.
- **Passed:** local Markdown file/anchor verification for all 11 changed/new Markdown files:
  69 local links resolved, with referenced site anchors checked against generated HTML where present.
  No trailing whitespace or accidental NUL characters were found, including in untracked new files.
- **Passed:** `git diff --check` for tracked changes. A separate structural check verifies task
  IDs/required fields and nine roadmap sections. Root management files are not site pages, so they
  were included in local validation rather than relying on VitePress to check them.
- **Additional path evidence:** installed Go standard-library `os/file.go:UserConfigDir` and
  `UserCacheDir` agree with the documented Windows/XDG roots. No config/cache contents were read.
- **Not run:** native app builds, browser interaction, live probes, game/server/database operations.
  These are docs-only changes; no application unit tests were needed. Interactive navigation/search
  remains unverified; the site build does not prove hydration works.
- **Completion:** DOC-001/002/003 Done; no task left In Progress. Remaining P1 work is DOC-004
  (database author workflows) and DOC-005 (high-risk write contract audit); no verified remaining P0.

## Inspection register: current

This register supersedes the initial sampled-area table for progress. IDs identify inspection
units, not implementation tasks. **Fully inspected** is a bounded static review of implementation,
configuration, relevant existing tests and relevant documentation; runtime validation is separate.
**Partially inspected** means substantive code was read but dependencies/contracts remain.
**Not inspected** means no feature-level implementation review, even if paths or incidental callers
were indexed/read. No parent subsystem is Fully inspected yet.

Session 4 completes **Broadly Audited** coverage for every S01–S14 parent and previously
untouched child family. **Deeply Audited** applies only to the already Fully inspected bounded
children. Audit status, static inspection depth, documentation quality and runtime evidence are
independent. Remaining-work cells describe deep follow-ups, not absent initial inspection.
The session-4 inventory remains the feature/document/gap/question map; session-5 evidence updates
the bounded deep questions and roadmap readiness. DA completion is question-resolution, not an
automatic Fully inspected label for a larger child family.

| Unit | Subsystem / boundary | Inspection depth | Audit status | Evidence or remaining boundary |
| --- | --- | --- | --- | --- |
| S01 | Desktop lifecycle, settings, project/config persistence | Partially inspected | Broadly Audited | Initial config/project samples; bridge shutdown, defaults/validation and multi-window failure tests remain |
| S02 | Documents, session restore, autosave/recovery and logs | Partially inspected | Broadly Audited | Session-5 recovery multipart/list/clean-quit tests and frontend timing/restore/quit paths reviewed; full restore/shutdown/log-error matrix remains DA-06 |
| S03 | WMAP persistence and legacy migrations | Partially inspected | Broadly Audited | Session-5 mapData v1–7/unknown flags, mapfile fixture contract and legacy export preservation tested; complete binary validation/codec compatibility remains outside DA-01 |
| S04 | MPQ/ADT/BLP/M2/WMO/DBC asset services and image/heightmap IO | Partially inspected | Broadly Audited | Session-7 image/list/brush/set dispatch/parser boundaries and heightmap codec tested; archive resolution/other codecs and native file-dialog round trips remain unverified |
| S05 | Terrain generation/editing, water, paths, selection and undo | Partially inspected | Broadly Audited | Session-7 generator, tile/paint/area/liquid scope and image import contracts resolved for DOC-006; prior growth/path evidence retained; exhaustive tools/native editing not certified |
| S06 | Models, WMO interiors, animation/effects, navigation, rendering/lighting | Partially inspected | Broadly Audited | Session-7 worker failure/job error, shared release, LOD/idle animation, client-light/weather/shadow/streaming limits reconciled; native WebGL/game fidelity and full shaders/effects/culling remain unverified |
| S07 | General UI, asset browsing, commands, preferences and accessibility | Partially inspected | Broadly Audited | Session-7 Check Map open/rerun/focus/fix/skip contracts and model-set controls checked; exhaustive panel/default/accessibility/native behavior remains unverified |
| S08 | Database authoring and client-table editors (parent) | Partially inspected | Broadly Audited | Child register below; do not infer complete editor coverage from shared helpers |
| S09 | Compile/publish, queued patches, backups and extraction | Partially inspected | Broadly Audited | WR-01/02/03 reused; DA-01 closes documentation-critical ExportMap/BuildRegion/orchestration questions with synthetic evidence; exhaustive serializer/live compatibility remains unverified |
| S10 | Lua execution, brush events, API, images/noise and script storage | Partially inspected | Broadly Audited | Session-6 selected prelude/host/session/brush/error/storage contracts, 32 Bun/three Go tests and two examples checked; broad external-script compatibility, unexpected host exceptions and native lifecycle remain |
| S11 | Developer testing, probes, browser harness, profiling and meldtool | Partially inspected | Broadly Audited | Foundation pure tests reviewed/run; full runner/CLI/harness workflows and safety guards remain |
| S12 | Build, dependency/binding generation, distribution and docs deployment | Partially inspected | Broadly Audited | Initial build/site scripts; installer and launcher builds, generated notices/binding internals remain |
| S13 | Game/character launch, process management and Benilla integration | Partially inspected | Broadly Audited | DB-10 and GAME-01/02/03 finished statically; GAME-04 app/character/SOAP and camera orchestration read and synthetic backend tests passed; floor/world probe reconciliation remains |
| S14 | Licensing, design provenance and GitHub/operator workflows | Partially inspected | Broadly Audited | DESIGN/reference scope read; notices generation, tracked workflows/templates and decision provenance remain |

### Database child units

| Unit | Exact feature boundary | Inspection depth | Audit status | Remaining work |
| --- | --- | --- | --- | --- |
| DB-01 | Connection-string parsing, CLI transport and local DB startup policy | Fully inspected | Deeply Audited | Relevant source/tests/docs reviewed; actual MariaDB permissions, Windows startup and Linux service behavior not executed |
| DB-02 | Generic TemplateEditor state controller, dirty comparison, save/refusal adapter | Fully inspected | Deeply Audited | Relevant source/tests/docs reviewed; does not include every editor, Svelte reactivity, frame focus/Esc or RowList |
| DB-03 | Generic INSERT/REPLACE parser, schema mapping, import/export SQL construction | Fully inspected | Deeply Audited | Relevant source/tests/docs reviewed; excludes item/spell asset portability extensions, UI dialogs and live DB execution |
| DB-04 | Item template find/new/copy/edit/save/SQL lifecycle | Partially inspected | Broadly Audited | Nonvisual core DB-04A finished; shared renderer/ref-picker dependencies remain in DB-05D/E; do not repeat SQL/controller review |
| DB-04A | Nonvisual item search/order, runtime fields, new-by-kind defaults and save/SQL core | Fully inspected | Deeply Audited | Session 2 core plus session 3 itemkinds/vendor item-search/itemFields/defaults/tests/docs; excludes shared pickers/rendering |
| DB-05 | Item look/icon/shot variants, equip bonuses, item sets/body dressing (parent) | Partially inspected | Broadly Audited | Child units below; common character-dressing and reference-picker paths remain |
| DB-05A | Item display catalogue, look picker and icon/shot display variants | Fully inspected | Deeply Audited | itemlooks source/tests, ItemLookPicker script/markup, field mapping and architecture/test recipes reviewed; patch writer tracked separately in WR-01/02 |
| DB-05B | Shared icon PNG import/export and grid | Fully inspected | Deeply Audited | icons/icon source/tests, app_icons, IconGrid script/markup and docs reviewed; excludes Icons tool's separate inspector and general BLP codec |
| DB-05C | Equip bonus selection and read-only set metadata | Fully inspected | Deeply Audited | equipbonus/itemsets source/tests, EquipBonuses UI, bridge and items.ts consumer read; not a set editor |
| DB-05D | Item dressing descriptors and tooltip composition (renderer belongs to S06) | Fully inspected | Deeply Audited | items visual/bodyskin/looks, wow/charskin and readEquipment, matching tests and docs/probe assertions reviewed; pure dressing/compositing tests passed; actual CreaturePreview/M2 rendering remains S06 |
| DB-05E | Item reference tables and shared RefField search integration | Partially inspected | Broadly Audited | Session-5 inherited object/quest table loading and refNames batching/null-cache behavior reconciled; no direct refNames transport/cache tests found. Numeric fallback is not reference validity; broad RefField UI/native lifecycle remains unexecuted |
| DB-06 | Creature/game-object templates and their related editor tabs | Partially inspected | Broadly Audited | DA-02 resolves documentation-critical independent Save/shared ownership, object template→loot→sound order and wizard gear-before-Make/create-before-update failure; native UI and every advanced tab are not certified |
| DB-07 | Quest templates, givers, dependencies and deletion planning | Partially inspected | Broadly Audited | Session-5 giver replacement, delete SQL/all-patch scope, plan-not-snapshot and retained character status reviewed/tested (F-019); concurrent live DB execution remains unverified |
| DB-08 | Spell DB/client writes and portable icon/visual metadata (parent) | Partially inspected | Broadly Audited | Persistence and portable metadata implementation read in session 3; starters/tables/composer/editor/readers and some tests remain |
| DB-08A | Spell row/client persistence, build selection and SQL look portability | Partially inspected | Broadly Audited | spells/spellscripts/spelllooks, dbc.go and bridge read; pure field/remap tests run; all spells/looks test source read; SpellEditor Save/Create/Import and probe reconciliation remain before Full |
| DB-08B | Starter defaults, cast/duration/range tables and field metadata | Partially inspected | Broadly Audited | spellstarters/spelltables source, starter/enchantment tests and docs read; spellFields miscField/effectFields/tab construction and tooltip algorithms/tests read; full enum/mask definitions/shared references remain |
| DB-08B1 | Backend starter defaults and option-table loading | Fully inspected | Deeply Audited | Entire spellstarters/spelltables, helpers_test TestStarterValues/starterTables, itemtables enchantment tests and live starter-test source, architecture and recipe reviewed; synthetic starter/enchantment tests passed; no real client scan |
| DB-08C | Visual composer, effects/sounds/missile preview and save files | Partially inspected | Broadly Audited | DA-05 resolves composer Apply/Save and visual/kit reuse/copy plus overlay/schema behavior; TestPlanVisual passed, spell-visual probe source read but not run; actual model/sound/missile rendering remains DA-03 |
| DB-08D | Spell reader/search/tooltip and editor workflows | Partially inspected | Broadly Audited | Entire spelltext/spelllist and tests, SpellPicker script/markup, wow/spells cache and spellFields preview algorithms/tests read; relevant architecture compared; SpellEditor and full probes plus enum/field integration remain |
| DB-09A | Spawn instances, GUID allocation, routes, pools and formations | Partially inspected | Broadly Audited | DA-02 resolves P1 GUID candidates/precheck limits, path_id 0 replacement, outside-region formation effects, shared pool updates and Save/partial-failure/SQL-record boundaries with synthetic tests; exhaustive UI/live DB concurrency remains unverified |
| DB-09B | Linked commerce, loot, messages/gossip, conditions and server scripts | Partially inspected | Broadly Audited | Session-5 gossip/text copying, direct versus inherited vendor rows and explicit object-loot copy/replacement reconciled with SQL tests; remaining conditions/script/runtime refresh claims require bounded follow-up |
| DB-09C | Areas, zone effects/sounds, lights/weather, taxi, world-map and other client tables | Partially inspected | Broadly Audited | Session-5 client-only versus DB→patch→server-copy destinations and queued Taxi callback timing resolved; synthetic Taxi/partial-failure tests passed; game/server visibility unexecuted |
| DB-10 | Game WDB/Benilla cache invalidation after template changes | Fully inspected | Deeply Audited | All cache.go/cache_test.go plus forgetStale/Session.Start integration and docs reviewed; missing-cache/corrupt-file/pruning tested with temp files; real locked-cache failure not executed |

### Write-pipeline and game child units

| Unit | Exact feature boundary | Inspection depth | Audit status | Remaining work / evidence |
| --- | --- | --- | --- | --- |
| WR-01 | Pending client-file storage, overlay and application watcher | Fully inspected | Deeply Audited | pending/app_pending implementations and tests, startup/status integration and docs reviewed; no real game lock exercised |
| WR-02 | Single-patch install, ownership, carry-over, backups and locking | Fully inspected | Deeply Audited | install/locked source/tests and guide/architecture/test sections reviewed; synthetic archive tests run, no power-loss/native-sharing simulation |
| WR-03 | Server extractor/movement-map backend orchestration | Fully inspected | Deeply Audited | publish.go UpdateServerMaps/extractServerMaps/buildMoveMaps/moveFiles, fake-runner tests, prefs and docs reviewed; excludes ExportMap serializer/external extractor implementation |
| WR-04 | Full region/new-world compile/export/publish orchestration and data builders | Partially inspected | Broadly Audited | DA-01 documentation-critical serializers, legacy preservation, border IDs/tiles and write/failure chain resolved; representative tests pass. Remains Partially inspected for exhaustive builder/test/helper scope; native compatibility unverified |
| GAME-01 | Game window policy and client-settings writes | Fully inspected | Deeply Audited | window source/tests, app GameWindow methods, preferences/game adapter and BENILLA/settings docs reviewed |
| GAME-02 | Session process lifecycle, login adapter and Benilla environment | Fully inspected | Deeply Audited | session/login/input source and tests, app session factory and relevant test/setup docs read; current Launch/Play Here callers are GAME-04, not all legacy Around methods are active save paths |
| GAME-03 | Optional launcher hidden-login policy and local build seam | Fully inspected | Deeply Audited | Rust source/embedded tests, manifest/build/toolchain/Cargo config and setup/test docs read; Cargo.lock is generated dependency inventory, sibling Benilla code/build excluded from this bounded review |
| GAME-04 | App Launch/Play Here, character logout/placement and SOAP | Partially inspected | Broadly Audited | All app_game/game adapter/character/soap and tests, portCoords/tests plus Engine playerSpot/groundBelow/frame/map-ID orchestration read; launch/floor/streamed-world probe bodies and deeper renderer dependencies remain |

## Continuation evidence — 2026-10-27, session 2

### Exact implementation and test review boundaries

- **DB-01 implementation/config:** `internal/vmangos/publish.go` from `worldDB` through
  `confDatabase` (including args/env), `spawns.go:runSQL/mariadbError`,
  `spawnedit.go:runScript/transactionScript/pipeMariadb/ApplySQL`, all of `dbstart.go`,
  `start_windows.go` and `start_other.go`, `templates.go:openWorld`, and the `hostOS`
  initialization/Supported boundary in `publish.go`. Runtime input is the configured server's
  `run/mangosd.conf`, `WorldDatabase.Info` and optional `database/my.ini`; no private files read.
- **DB-01 tests/docs:** `helpers_test.go:TestConfDatabase/TestCantConnect`;
  `spawnedit_test.go:TestRunScriptWrapsATransaction/TestNoScriptBuilderOpensATransaction`;
  all `offwindows_test.go` for the relevant process/platform boundary. No dedicated
  `ensureDatabase/databaseProgram` startup tests were found by symbol search; startup was not
  verified live. Reviewed README requirements, setup prerequisites, troubleshooting symptoms,
  `docs/TESTS.md` MyISAM warning and `docs/architecture/client.md` platform/batch sections.
- **DB-02 implementation/tests:** all of `frontend/src/lib/ui/templateEditor.svelte.ts`,
  `state/saving.ts`, `world/creatureFields.ts:changedValues`, `tests/templateEditor.test.ts`
  and its `tests/runes.ts` shim. Also read all `ui/templateIo.ts` and `components/EditorFrame.svelte`
  for caller context, but focus/Esc helpers and separate IO-helper tests were not reviewed/found.
  Configuration is the controller's options/callbacks, not a new user setting. Reviewed
  `docs/architecture/client.md` “The editors' shared frame” and
  `docs/tests/spawns.md` “The database editors' shared frame”.
- **DB-03 implementation/tests:** all `internal/vmangos/sqlparse.go`, `sqlscript.go` and
  `batch.go`; shared schema/value/read/update functions in `templates.go` from `TemplateColumn`
  through `keyedUpdateSQL`. Read `items_test.go:TestParseInserts/TestPlanImport/TestItemsScriptRoundTrip`,
  `spellscripts_test.go:TestSpellScriptRoundTrip`; `templates_test.go` tests `TestParseColumns`,
  `TestCreatureUpdateSQL`, `TestUnescapeBatch`, `TestBatchRows`, `TestEditorSavesRefuseOutOfRangeValues`;
  `helpers_test.go:TestIntRange/TestSQLValue`. The first `TestSpellScriptLooks` section was read
  only to check generic handling of comments; its portability algorithm remains DB-08.
  Read item/spell SQL paragraphs in `docs/architecture/client.md` and the item SQL test recipe
  in `docs/tests/spawns.md`. Imported schema/order/ranges are runtime configuration here.
- **DB-04 substantive trace:** `ItemEditor.svelte` script and markup through `modelView`
  (before styles); all `app_items.go`; `items.go` through `ImportItems` (before `ItemLook`);
  `templates.go:createTemplate/copyTemplateSQL`; `app.go:serverAndData`,
  `app_sandbox.go:serverForWrite`, `app_editors.go:templateSaved/forgetStale`;
  `app_saves_test.go:TestTemplateSavedHandsOverTheRefusedColumn`; remaining `items_test.go`,
  including read-only live-test source (not run). Reviewed relevant item/shared-frame sections in
  client architecture, item checks in `docs/tests/spawns.md`, and menu/save warnings in the manual
  and save/compile guide. Item style rules, child components and full metadata/preview backend
  are not audited. `items.go` preview introduction/slot mapping were read incidentally, not completed.
- **Supporting boundaries, not full units:** `app_pending.go` through `installClientFiles` and
  `waitForGameClosed` loop; `pending.go:InstallWithPending/WithPending`;
  `install.go:InstallPatch/installPatch` through return (not `replaceKeepingPrev` onward);
  `locked.go`; `internal/game/cache.go` through `Stale.Forget` and `pruneWDB` introduction.
  These establish caller order, not complete patch/cache/recovery correctness.
- **Probe/document comparison:** `frontend/probes/item-editor.js` leading contract, initial
  search/preview steps, invalid-level/Revert block and final relevant assertions were inspected;
  not the entire probe. Read its matching regression recipe. The remaining actions/probe helpers
  and `item-pickers.js` are still uninspected. No probe was executed.

### F-007 — Database connection/startup prerequisites lack troubleshooting coverage

- **Verified:** queries invoke the executable named `mariadb` via PATH, independent of the server
  folder picker. Credentials come from `run/mangosd.conf`'s five-part `WorldDatabase.Info`,
  not Game Login. Args omit the password; it is supplied as `MYSQL_PWD`. Missing/malformed config,
  missing CLI, authentication and offline-service failures therefore have different remedies.
- **Verified side effect:** `openWorld` calls `ensureDatabase` even for reads, planning and SQL export.
  Only connection-class errors trigger local startup; on Windows this requires `database/my.ini`
  and a daemon beside the discovered CLI, followed by up to 30 seconds of connection retries.
  Off Windows, the service must be started separately. A `mysql` lookup fallback exists only in
  daemon discovery; normal query/script execution still requires `mariadb`.
- **Documentation comparison:** README/setup mention a MariaDB database but no CLI/PATH or
  connection contract; troubleshooting has Play Here/compile symptoms, not these DB failures.
  Architecture's limited startup/platform description is useful but not an author diagnostic guide.
- **Disposition:** new DOC-012 P1 Todo. Static code supports these distinctions; no claim of a
  successful native/Linux/database startup test. Do not reproduce credentials in examples.

### F-008 — SQL import is restricted row replacement, not script replay or a full package

- **Verified:** parser takes target-table INSERT/REPLACE VALUES, skips other statements/tables,
  rejects target INSERT SELECT and ON DUPLICATE KEY UPDATE, and maps unnamed tuples using the
  destination table's current order. Unknown columns are dropped; absent columns are not merged
  with an existing row. Generated REPLACE writes supplied fields with destination defaults for
  omitted columns. This default behavior is the explicit code contract, not a live-schema result.
- **Verified limits:** plan checks shape/keys and which rows already exist, not every value; import
  performs schema-value validation before issuing the generated SQL. UI and bridge reread the
  file at confirmation, rather than pinning the displayed plan's bytes. Do not edit a planned file
  and assume confirmation executes an immutable preview. Item export includes every patch row
  with no attached display/icon payload (`ExportItems` passes no extra metadata callback).
- **Documentation comparison:** developer architecture accurately explains target-table filtering,
  unknown columns and per-patch export. It is sufficient for that implementation overview, but
  omits author-facing defaults/overwrite, preview-limit and asset-portability precautions.
- **Disposition:** refine DOC-004 acceptance, not a duplicate SQL-reference task. These are
  documentation needs; no claim that arbitrary original SQL is executed or a product defect proved.

### F-009 — Item Save can write a display before the database write fails

- **Verified ordering:** `ItemEditor.save` awaits `ItemDisplayVariant` first, updates display_id and
  clears pending look choices, then calls `SaveItem`. The bridge may already install or queue a
  client DBC. A later SQL/refused-value failure has no compensating client-patch rollback in this
  path. Ordinary value-only Save performs a DB UPDATE; Make item/Import persist separately.
- **Verified undo boundary:** controller Revert restores unsaved UI values; it is not a map
  History operation. Script transaction framing is real, but `TestRunScriptWrapsATransaction`
  explicitly notes that MyISAM writes cannot be undone by transaction rollback. Prevalidation
  failures write nothing, but a later database-execution failure is not proven atomic.
- **Documentation comparison:** existing UI warnings, restart guidance and the general backup
  warning are useful; the author workflow does not yet explain independent side effects or
  partial-failure triage. The architecture already records the display-before-row order.
- **Disposition:** refine DOC-004/005; keep P1. No live partial failure was induced, no corruption
  was observed, and the item display construction/cache pipeline remains to be audited.

### F-010 — Item regression prose claims a save/refusal action the probe no longer performs

- **Verified mismatch:** `docs/tests/spawns.md` “Item editor” says level 300 is refused and jumps
  to Requirements in `item-editor`. The current probe explicitly never presses Save: it enters
  300, switches back to Item, records the Save count and reverts. Its final assertions check
  unchanged stored values, not an automatic refusal/tab jump.
- **Actual separate evidence:** Go `TestEditorSavesRefuseOutOfRangeValues` checks SQL/column refusal;
  Bun `TemplateEditor` tests verify the refusal callback. Neither is a browser proof of the full
  item Save path. The prose conflates those levels of evidence.
- **Disposition:** confirmed Outdated section, added to DOC-009 (still P2); do not edit the recipe
  during audit-only work or invent a successful live check.

### F-011 — Architecture overstates Linux patch-write waiting

- **Verified mismatch in the traced item/client-file path:** architecture's “Server tooling is
  Windows-only” paragraph says process detection makes a patch write wait off Windows.
  `App.gameRunning` explicitly returns false off Windows, and `queueClientFiles` therefore
  directly calls `InstallWithPending`. That function/installPatch do not poll game processes.
  `OSRunner.Running` does have Linux process detection, but this call path bypasses it.
- **Documentation comparison:** `offwindows_test.go` proves process-name detection, not its use
  by this item-file queue. Existing user instructions to close/restart the game remain prudent;
  this finding does not prove all compile/launch paths or native clients behave identically.
- **Disposition:** confirmed Outdated architectural statement; make this a first concrete check
  under DOC-005 P1. Trace other callers/tests before deciding the full wording. Do not infer a
  product bug, file corruption or unsupported-platform success from source alone.

### Sufficient coverage and exclusions confirmed this session

- Generic TemplateEditor lifecycle/refusal behavior is already explained accurately in the shared
  frame architecture and test recipe. Its tests cover stale reads, dirty/discard/reopen and refusal
  handling. No new helper-by-helper tutorial or separate controller document is justified.
- Generic batch unescaping and target-table SQL filtering have useful developer-level coverage;
  reader safety belongs in the existing DOC-004 workflow, not duplicate implementation prose.
- `docs/TESTS.md` already warns about MyISAM/non-rollback and disposable databases. Preserve it;
  carry the appropriate author-specific consequences into eventual workflow work.
- Item UI itself explains tooltip-before-save, creation modes, overwrite confirmation and world
  server restart. Reuse these contracts; do not repeat every field, search sort or visual helper.
- Transaction internals, every parser escape and every schema integer bound do not warrant new
  standalone pages. Tests/source are the canonical exhaustive details.
- DOC-001/002/003 remain Done. This session did not reverify every storage-guide claim and found
  no evidence requiring those completed scopes to reopen.

### Validation, priority outcome and next boundary

- Passed 16 selected pure Go tests with the command below. The selected bodies were reviewed
  first; none connect to a real DB or start a server. Run from the repository root:

```powershell
go test ./internal/vmangos -run '^(TestConfDatabase|TestCantConnect|TestParseInserts|TestPlanImport|TestItemsScriptRoundTrip|TestSpellScriptRoundTrip|TestCreateItemSQL|TestParseColumns|TestCreatureUpdateSQL|TestUnescapeBatch|TestBatchRows|TestEditorSavesRefuseOutOfRangeValues|TestIntRange|TestSQLValue|TestRunScriptWrapsATransaction|TestNoScriptBuilderOpensATransaction)$' -count=1 -v
```

- Passed `cd frontend; bun test tests/templateEditor.test.ts`: 14 tests, 46 expectations.
  The runes shim makes this state-machine validation, not browser/Svelte-reactivity verification.
- No implementation task completed or started; only the three management files changed in this
  session. No live probe/database/game/daemon operation, packaging build, commit, issue or schedule.
- Priority outcome: no verified P0; DOC-004/005 remain P1 with sharper acceptance criteria;
  DOC-012 adds P1 database-readiness troubleshooting. DOC-005 now has a confirmed platform mismatch;
  DOC-009 gains a specific P2 stale-recipe correction. No duplicate SQL/controller task was added.
- **Next inspection, not implementation:** finish DB-04's non-visual dependencies in order:
  `internal/vmangos/itemkinds.go` and tests (new-by-kind), item search/read in `vendor.go` and
  tests (latest-patch/sort/limit), `frontend/src/lib/world/itemFields.ts` and `tests/itemFields.test.ts`
  (field/enum/schema mapping), then DB-10 cache pruning/session-start tests. Record a separate
  completed boundary before DB-05 display/icon/shot/body/tooltip work.
- Then inspect DB-08 spell DB/client/portable looks, DB-06 creature/object, DB-07 quest and
  DB-09A/B/C as separate domain slices. Reconcile cross-path pending/partial-write findings with S09
  before moving outward through S01–S14. Do not jump to prose implementation or mark any parent Full.
- Management validation passed: all 17 local Markdown links/section anchors resolve; all 12
  unique task IDs retain required fields; all nine roadmap sections exist. Separate checks of
  the untracked management files found no trailing whitespace or NUL bytes.
- `git diff --check` passed. SHA-256 comparisons confirm all nine preexisting changed/new
  non-management documentation files are unchanged by this session. Existing unrelated frontend
  changes and untracked operator files were left untouched.
- `cd frontend; bun run docs:build` passed. VitePress reported a non-fatal bundle-size warning
  for chunks above 500 kB; no build failure. No browser validation was performed.

## Continuation evidence — 2026-10-28, session 3

### Exact implementation, configuration and test boundaries

- **Baseline reconciliation:** one commit, e8c86e9..98e7a4d. Read changed hunks in
  App.svelte (palette fetch/dirty-state race), probes/autosave.js, probes/preview-context.js
  (stale GPU-delete error accounting), docs/tests/ui.md and docs/tests/rendering.md.
  This is change reconciliation, not a new full autosave/render audit. Uncommitted onboarding,
  navigation/build docs, settings guide and operator files predate this session and are preserved.
- **DB-04A:** all internal/vmangos/itemkinds.go/itemkinds_test.go; vendor.go item-specific
  SearchItems/SearchItemsSorted/itemOrder/ReadItem/ItemIcons and corresponding vendor_test.go
  assertions; all lib/world/itemFields.ts/tests/itemFields.test.ts; editor.svelte.ts itemSort
  defaults. Kinds need at least three latest-patch examples; defaults take common basics/median
  delay and durability, not borrowed performance stats. Sorting precedes the 100-result cap.
  The rest of vendor commerce is not inspected. Earlier session-2 item lifecycle evidence stands.
- **DB-05A/C:** all itemlooks.go/itemlooks_test.go, equipbonus.go/equipbonus_test.go,
  itemsets.go/itemsets_test.go, wow/items.ts and relevant app_items bridge calls; ItemLookPicker
  and EquipBonuses script/markup before styles. Traced display classification/fits/shot votes,
  copy/deduplication, passive equip bonuses into five effect slots and read-only set metadata.
  No item-set authoring feature was inferred from a metadata reader.
- **DB-05B:** all vmangos/icons.go/icons_test.go, app_icons.go, wow/icon.go/icon_test.go and
  IconGrid script/markup. PNG conversion requires a square image of 8–4096 pixels, resamples
  to 64 pixels and writes DXT3/mips. Names have character/100-character limits; stock icons are
  protected, Meld icons replaceable; batch results can mix successes/refusals. PNG exports use
  os.WriteFile on name.png. Import invokes saveClientFiles immediately. Reviewed icon IO/patch
  descriptions and recipes in docs/architecture/client.md and docs/tests/client.md.
  Standalone Icons inspector and general BLP decoding remain outside this bounded inspection.
- **DB-05D/E:** all bodyskin.go and items.go from ItemLook onward; itemTooltip.ts and both
  ItemTooltip/ItemTooltipBox script/markup, all itemTooltip tests, itemtables.go and tests.
  Tooltip uses unsaved values, tolerates unresolved names/spells, displays zero-worn set metadata
  and editor-only information. Later in this session the shared dressing and reference units
  were advanced as recorded below; the visible component alone is not evidence of renderer review.
- **DB-10:** all game/cache.go/cache_test.go; app_editors forgetStale, App stale tracking,
  app_game gameSession and game/session Start/ForgetStale integration. Reviewed template-cache
  recipe in docs/tests/client.md. Targeted WDB pruning, malformed-file deletion, absent-cache
  success, Benilla's tagged creature-name TSV filtering and .meld replacement were traced.
  Aggregate errors retain all stale sets; only success clears them. Start logs pruning failure
  but still attempts launch. IDs are memory-only; no real locked-cache test was attempted.
- **DB-08A:** all spells.go, spellscripts.go/spellscripts_test.go, spelllooks.go and
  spelllooks_test.go including iconTable tail; all app_spells.go. Read dbc.go parsing,
  setRecords, putRecord and record; all spells_test.go including gated client/DB tests (not run).
  SQL uses the latest build no newer than 5875; planning can precede SQL, server reload and client
  writes, whose failure does not roll back the DB. Imported metadata carries icon paths/visual
  and kit rows, not image bytes. Missing/broken metadata leaves numeric references. putRecord
  preserves existing rows/strings while appending replacement strings. Visual builder internals
  are DB-08C, not credited from reading their callers; full editor handlers/probes still remain.
- **DB-08B1 and partial B/D:** all spellstarters.go/spelltables.go; helpers_test.go
  starterTables/TestStarterValues; itemtables_test.go TestSpellEnchantmentNames; live starter
  test source. Six starter kinds select actual client option rows by value, skip scaled options
  where marked and fail if required rows are absent; matching stock spell names supply icon/
  visual or fall back to no visual/Temp. Optional enchantment-table failures yield no names.
  Reviewed corresponding architecture/client starter/DBC paragraphs and spell regression notes.
  spellFields.ts miscField, effectFields, spellTabList, spellTabs and all preview/token/summary
  functions plus entire spellFields.test.ts were read; other enum/mask definitions remain partial.
- **DB-08D:** all spelltext.go/spelllist.go/spelllist_test.go and the vendor_test.go
  TestSpellTextsFromClient source (not executed). Read all wow/spells.ts and SpellPicker script/
  markup before styles. Compared architecture/client spell-list/cache paragraphs and relevant
  spawns recipes. Browsing filters noise, but an exact ID bypasses category/school filters;
  every includes leftovers. Search orders exact ID/name, prefix, substring and rank/ID. The picker
  pages by 200, remembers category/school for the session and rejects stale list results; the
  bridge caps requests at 2000. Frontend preview leaves unsupported tokens intact; neither it
  nor passing synthetic tests proves every in-game tooltip case. Full SpellEditor, probes and
  shared field/reference integration still remain. creatureSpellNames introductory definitions
  were read incidentally, not its complete creature-spell workflow.
- **WR-01/02:** all app_pending.go/app_pending_test.go, vmangos/pending.go/pending_test.go,
  install.go/install_test.go, locked.go/locked_test.go, and startup/status pending integration.
  Pending files are keyed by normalized client path and newest name, read before installed files,
  merged under patchMu and removed only if unchanged since read. Startup resumes the watcher;
  it polls every three seconds and retries in-use errors up to five attempts 30 seconds apart.
  Ownership checks, .before-meld migration backup, single .prev, synced temporary write,
  suspended reader/rename and attempted rename rollback were reviewed with guide/test sections.
- **WR-03/04:** all vmangos/publish.go, relevant fake-runner publish_test.go extraction/wait/
  movement-map bodies; compile.ts, publish.ts, applyNote.ts and app_region background handlers.
  Read buildMoveMaps preference default/control; all external steps and failure branches were
  traced without running extractors. guard_test.go first 100 lines were read for test safety,
  not a complete guard/harness audit. ExportMap, earlier SaveRegion serialization, builders and
  publish_chain_test.go remain. ChangedTiles test/helper review is not credited here.
- **GAME-01/02/03:** all game/window.go/window_test.go, session.go/session_test.go,
  login.go/login_test.go, input_windows.go/input_other.go; all launcher main.rs/hidden_login.rs
  including embedded tests, Cargo.toml, build.rs, rust-toolchain/rustfmt and .cargo/config.toml.
  Reviewed preferences window/client controls, BENILLA.md, saving/launch guide, troubleshooting
  and relevant client recipes. Own-window policy writes nothing; config errors log without
  blocking launch. Benilla login environment requires account/password, hidden-login additionally
  needs character; launcher reveal timeout is 30 seconds. Logs are overwritten per launch.
  Windows native login waits for a window and checks focus before strokes; non-Windows has no
  native typing adapter. Legacy Around methods do not imply current compile callers use them.
  Generated Cargo.lock and external sibling Benilla implementation are excluded from local seam
  coverage. No Rust build/test or native game launch occurred.
- **GAME-04:** all app_game.go and io/game.ts, character.go/character_test.go,
  soap.go/soap_test.go, portCoords.ts/portCoords.test.ts; Engine playerSpot, groundBelow,
  serverTiles/serverOrigin/tileOrigin/globalBuilding and map-ID loading/lookup orchestration.
  Launch placement waits up to 150 seconds for logout, clears transport/taxi/instance fields,
  then starts the client; Play Here uses online character checks, a rewritten meld_here world
  table row and two SOAP commands, not client restart. SOAP uses configured host/port, HTTP
  Basic auth and a ten-second timeout; spell reload requires its separate server permission.
  Existing author launch/SOAP requirements are sufficient. Rendering-dependent floor picking,
  streamed-world assertions and full launch/compile probes still need reconciliation.

All frontend paths above are under frontend/src unless explicitly named as tests/probes; Go
paths without a prefix are under internal/vmangos unless game/, wow/ or root app_ is specified.
Source/test review is static evidence; only the selected synthetic tests below were executed.

### F-012 — Icon import/export needs author-facing persistence precautions

- **Verified:** app_icons ImportIcons calls saveClientFiles independently of Item/Spell Save;
  cancelling that parent editor does not undo the icon-file import. Naming/stock protection,
  replacement, partial batch outcomes and PNG export overwrites are implemented in icons.go,
  wow/icon.go and IconGrid. Image import and later DBC assignment are distinct operations.
- **Comparison:** developer architecture/recipes already explain much of the implementation;
  authors lack one concise safe workflow. This is an audience gap, not a missing icon subsystem.
- **Disposition:** refine DOC-004 P1 and cross-link DOC-005 safety; no duplicate icon manual.

### F-013 — Template-cache troubleshooting is insufficient for authors

- **Verified:** cache invalidation tracks IDs in memory, prunes on a Meld-driven start, logs
  failures without aborting launch and removes malformed WDB files. After saving while a game
  runs, an external restart or ending Meld first can therefore leave game-visible template data
  stale. This describes a supported failure possibility, not an observed live corruption event.
- **Comparison:** docs/tests/client.md already states the memory-only/external-launch limitation
  accurately. Preserve that developer coverage; author troubleshooting lacks the same remedy.
- **Disposition:** DOC-005 P1 and DOC-009 P2 linkage, not a new cache guide or reopening DOC-002.

### F-014 — A current extractor regression recipe retains an obsolete restart claim

- **Verified mismatch:** docs/tests/client.md, Server map extraction, says a failed step leaves
  old files and starts mangosd again. UpdateServerMaps never starts/stops it; reviewed fake-runner
  tests assert this. The page also correctly states the newer no-restart policy elsewhere.
- **Related caution:** mmap.enabled stays 0 is a machine observation in the movement-map recipe,
  not a setting Meld enforces. publish.go leaves it unchanged. io/game.ts still emits explanatory
  status text claiming export/Compile restarts the game. This source/UI mismatch is recorded for
  engineering follow-up only; no source edits are authorized, and guides must not copy it.
- **Disposition:** DOC-005 P1 / DOC-009 P2, preserve the already-correct launch/compile guide.

### F-015 — Recovery instructions must distinguish extraction staging from all-or-nothing publish

- **Verified:** extractServerMaps stages extractor output and does not replace installed data
  if an extractor step fails. Subsequent deletions and per-file moveFiles renames are not one
  atomic rollback. Whole-map movement-map generation removes old map mmaps first; absent or
  failing generator logs without making the main publish fail. buildMoveMaps defaults true;
  mmap.enabled is never changed. A successful publish is not proof of validated pathing data.
- **Comparison:** the current guide correctly advises backups and manual server control; it
  needs bounded recovery semantics, not replacement with another guide. Tests establish
  extractor-step protection, not every filesystem/power-loss rollback or native tool behavior.
- **Disposition:** sharpen DOC-005 P1. No claim that corruption occurred, or new implementation task.

### Sufficient coverage and deliberately excluded expansion

- DB-01/02/03 developer contracts, read-only item sets, passive equip-bonus selection, launcher/
  window policy, core Launch/Play Here prerequisites and starter creation internals have useful
  existing architecture/UI/recipe coverage. Link it rather than writing separate helper manuals.
- Extend F-008 rather than duplicating it: spell portability includes paths/rows, not custom BLP
  bytes, and assumes stock nested effect/sound IDs. DOC-004/005 retain ownership of that boundary.
- Do not add exhaustive icon-name lists, starter-default dumps, tooltip-token permutations,
  generated bindings/dependency-lock explanations or per-field enum tutorials. Reconsider only
  a concrete reader task/confusion; tests/source remain the exhaustive implementation record.
- DOC-001/002/003 remain Done; this audit completes no backlog implementation. Existing task IDs
  DOC-001 through DOC-012 are retained; new findings refine tasks instead of growing the backlog.

### Checks, priority outcome and continuation

- Passed 94 selected Go tests: 11 item/bonus/icon classification tests, five game-cache tests,
  two PNG conversion tests, 21 DBC/spell/patch/pending tests, two root watcher/chain tests, seven
  server-extraction tests, 20 session/window/login tests, ten character/SOAP/icon-search tests,
  three starter/reload/enchantment tests, one spell-noise test, six dressing/equipment tests,
  two skin-composition tests and four item-reference tests. Every selected body was
  reviewed first; commands use explicit anchored Test-name allowlists, -count=1 and -v.
  Packages: ./internal/vmangos, ./internal/game, ./internal/wow and . . No broad live-test run.
- Passed Bun tests/itemFields.test.ts (2), tests/itemTooltip.test.ts (9),
  tests/portCoords.test.ts (9) and tests/spellFields.test.ts (7): 27 total. No browser/probe run.
- No P0 verified in inspected scope. P1 remains DOC-004/005/012; within P1, DOC-005 should be
  implemented first once authorized because F-011/014/015 affect write/recovery expectations.
  DOC-009 remains P2 with concrete recipe corrections. No task priority/status is inflated just
  because more code was read. No task is In Progress at handoff.
- Six workers failed before useful reports; their assignments confer no coverage. The user's
  subsequent usage-reset notice changes availability, not the evidence record. Work continued
  locally with no provider switch. Initial audit remains incomplete: S06 Not inspected, all
  other parents Partial. See the current register, not the historical sampled-area table.
- **Next exact boundary:** finish DB-05E inherited lock/page/language lookup implementations
  and shared-reference tests, without rereading completed item dressing/reference transport.
  Then finish spell editor/composer/field/probe
  reconciliation, WR-04 serializers/publish chain and GAME-04 floor/world probes; then untouched
  DB-06/07/09 families and outward S01–S14 units. Roadmap section 9 provides the ordered handoff.

### Final item-family continuation within session 3

- Read all looks.go/looks_test.go, wow/charskin.go/charskin_test.go and spawns.go
  readEquipment/intList/atoiAll. These complete DB-05D's descriptor/compositing dependencies:
  required versus optional model tables, baked versus composed skins, race/sex and helmet
  geosets, robe/boot precedence, cloak/hand attachments, pose selection, highest-probability
  equipment rows and latest-patch item displays. Missing optional tables/layers can reduce the
  preview; the skin base must decode, later missing/bad layers are skipped. Existing architecture
  and body-armour recipe already explain the model-versus-painted-body distinction accurately.
  No new per-geoset or compositing tutorial is warranted; rendering remains S06.
- Read all RefField and TemplateFields scripts/markup before styles, all wow/refNames.ts,
  app_editors ItemTables/WorldRefNames/SearchWorldRefs and objecttables.go from itemNameSQL
  through SearchWorldRefs. ItemTables/itemtables tests were already reviewed; the added trace
  connects map/category/set lists and enchantment/disenchant routes to UI/cache behavior.
  Shared reference queries summarize existing rows; they do not implement those rows' editors.
  This does not audit the loot/vendor/gossip systems whose names the picker happens to show.
- Read entire probes/item-editor.js and item-pickers.js and compared corresponding item/body/
  picker recipes. Neither probe was executed. The picker mutates unsaved fields; the item probe
  explicitly never presses Save for invalid level, confirming F-010 rather than fixing it.
  Full probe-source reading adds no live rendering or DB-write evidence. Shared cache/reference
  behavior still needs test/related domain lookup reconciliation before DB-05E is Full.
- Corrected a handoff assumption: the search lives inside RefField.svelte, with SpellPicker
  for spells; there is no RefPicker.svelte. refNames.ts is under lib/wow, not lib/world.
  Nonexistent inferred filenames never counted as inspected implementation. Remaining inherited
  lock/page/language lookup/table loading should be traced in objecttables/templates/quest
  dependencies when finishing DB-05E; do not repeat the completed query transport.
- Additional commands passed (all synthetic, from repository root):

```powershell
go test ./internal/vmangos -run '^(TestCreatureLookDressesAHumanoid|TestCreatureLookShowsHairWithoutAHelmet|TestHoldWeapons|TestPoseAnim|TestReadEquipment|TestItemLookPaintsBodyArmour)$' -count=1 -v
go test ./internal/wow -run '^(TestComposedTextureRoundTrip|TestPaintRegion)$' -count=1 -v
go test ./internal/vmangos -run '^(TestSpellCategoryNames|TestRandomPropertyNames|TestEnchantments|TestDisenchantSQL)$' -count=1 -v
```

### Final management validation — session 3

- Passed `cd frontend; bun run docs:build`; VitePress built/rendered all site pages. The existing
  non-failing warning for chunks over 500 kB remains. Root management files are not site pages.
- Passed all 17 local Markdown links and section-anchor checks across the three management
  files, nine roadmap sections and 12 unique task IDs with required fields. Separate checks
  found no trailing whitespace or NUL characters in the untracked management files.
- Passed `git diff --check`. SHA-256 comparison against the session-start snapshot confirms
  all 1,146 tracked files are unchanged by this audit, including preexisting modified guides.
  Only the three management files were edited; the preexisting untracked settings guide and
  operator files were not edited. No application changes, backlog implementation, commit or branch.
- No browser/navigation/search validation, native packaging, Rust build/test, live game/server/
  database/extractor or live probe was attempted. Successful static reviews/tests/builds do not
  complete the initial repository-wide audit; the current register remains the authority.

## Breadth-first completion — 2026-10-28, session 4

### Method, scope and stopping boundary

The user's breadth-first request supersedes the session-3 depth-first next steps. S06 was inspected
first, followed by previously untouched database families, then the remaining outward subsystem
boundaries. Completed SQL/controller/item/cache/patch/game-session reviews were reused, not repeated.
All S01–S14 are **Broadly Audited**; no parent is Deeply Audited. No identified family remains
Unaudited. This is a major-feature inventory, not proof that every implementation detail was checked.
No deep follow-up was started after broad coverage was established.

Evidence below names selected bodies/sections read, not whole files unless explicitly stated.
Existing documentation mappings include source-comparison samples and text searches; they are not
whole-page accuracy certification. Test/probe paths listed as follow-ups were indexed, not executed
or fully reviewed. Failed speculative path lookups supply no evidence: water editing lives in
`tools/TerrainTools.ts:WaterTool`, DBC parsing in `internal/vmangos/dbc.go`, command dispatch in
`ui/runCommand.ts`, creature creation in `CreaturesWorkspace.svelte`, and launch checks include
`probes/compile-launch.js`. No separate LiquidTool, dbc package or inferred launch-spawn probe
was credited. Source baseline and changed-file preservation are recorded in Latest audit.

### S01 — Desktop, settings and projects

- **Audit / documentation:** Broadly Audited / Partial overall; existing storage/privacy scope
  remains Complete, not every setting or native lifecycle path.
- **Features/evidence:** desktop boot/client loading, remembered window size, unsaved close request
  and second-close timeout; project open/close/forget without deleting files. Read
  `app.go:startup/beforeClose/stopClose/AckClose/saveWindow`, `main.go:wails.Run` options/middleware
  and `io/project.ts:openProject/closeProject/forgetProject/projectReady`; reuse config review.
- **Docs/gaps:** `README.md`, `docs/getting-started.md`, `docs/guides/settings-and-data.md`,
  `docs/troubleshooting.md` cover setup/storage well. First-run/native failure remedies remain
  Unverified, not Missing wholesale; DOC-011/012.
- **Open/deeper:** multi-window updates, close acknowledgement during busy work, defaults and
  invalid-config fallback need bounded tests/reference reconciliation. Deeper review necessary,
  below write/authoring risks; no reason for an exhaustive preference-key catalog.

### S02 — Documents, recovery and logs

- **Audit / documentation:** Broadly Audited / Partial overall; settings/data recovery distinction
  is sufficient for its stated storage scope.
- **Features/evidence:** saved-file/region/world tabs and camera snapshots, dirty-tab periodic
  recovery, disabled interval/mid-stroke/busy guards, session log forwarding. Read
  `io/session.ts:capture`, `io/recovery.ts:startAutosave/autosave` through copy setup and
  all `io/sessionLog.ts`; reuse recovery/store/config path evidence.
- **Docs/gaps:** settings/data and troubleshooting distinguish session restore from backups;
  save/compile guide covers recovery destinations. Full cleanup/crash/multipart failures and log
  retention remain Unverified rather than a new generic guide requirement; DOC-005/009.
- **Open/deeper:** recovery copies versus saved paths, repeated close/crash and failed part writes
  need reconciliation with `internal/recovery` tests and autosave probes. Deeper review necessary.

### S03 — WMAP persistence and legacy data

- **Audit / documentation:** Broadly Audited / Partial; full compatibility Unverified.
- **Features/evidence:** versioned gzip working files, base64 bridge blobs, legacy paint and
  unknown-data preservation, temporary-file/sync/rename Save. Read
  `internal/mapfile/mapfile.go:Read` preamble/version/header/initial blobs and `Save`,
  format/version comments, `io/mapData.ts:toMapData` opening conversion, and
  `version_test.go` fixture-generation contract; reuse prior header/fixture evidence.
- **Docs/gaps:** `docs/architecture/terrain.md`, save/compile guide and mapfile tests describe
  format/preservation boundaries. No user-facing byte-layout dump needed. Full v1–7 migration,
  malformed input and read-write preservation accuracy remain DOC-005/006 deep prerequisites.
- **Open/deeper:** do all serializers keep legacy unknown holes/liquids/chunk flags and optional
  metadata? Fixture existence is not a passed round trip. Deeper review necessary before safety claims.

### S04 — Asset services and exchange

- **Audit / documentation:** Broadly Audited / Partial author coverage, deep codec accuracy Unverified.
- **Features/evidence:** MPQ priority/resolution, client caches/overlay and binary texture replies,
  ADT terrain, M2 models, WMO groups, BLP pixels and DBC records. Read
  `internal/mpq/set.go:priority/OpenDataDir`, `wow/client.go:load` and Handler status/texture/thumb
  branches, parser entry/validation bodies in `wow/{blp,m2,wmo}.go`, `adt/adt.go:ParseTerrain`,
  `vmangos/dbc.go:parseDBC`. Height/normal PNG export and height import math were sampled in
  `io/images.ts` and `io/heightmapImport.ts:imageRatios/importHeights/importHeightsOnTile`.
- **Docs/gaps:** manual Import/Export menu row, terrain/client references, `docs/tests/client.md`
  and tooling explain implementation/checks but do not give a complete author exchange workflow
  with image dimensions, units, overwrite/scope and asset portability; F-017, DOC-006.
- **Open/deeper:** archive fallback/errors, unsupported formats, texture GPU fallback, image
  resampling and binary transport deserve selective tests. Deeper review necessary, not every codec now.

### S05 — Terrain, generation, water and placement

- **Audit / documentation:** Broadly Audited / Partial; existing everyday tool explanations useful.
- **Features/evidence:** nine terrain presets and heightmap starts, erosion/beaches, sculpt/paint/
  masks/roads, spline roads/rivers/fences, separate liquid paint versus sea/shore shaping, placement,
  scatter, clear, stamps, holes/map data, selection/clipboard and undo. Read
  `terrain/generate.ts:generateHeights/imageGroundHeights`, preset definitions,
  `tools/TerrainTools.ts:BrushTool` stroke lifecycle and `WaterTool` stroke/tick/apply branches,
  `PathTool.ts:apply`, `StampTool.ts` shared stroke, `MapDataTool.ts:apply`, and tool registration.
  Read `io/regionGrow.ts:grownBlock`, `io/worldGrow.ts:growSnapshot` initial buffer copying,
  `MapPropertiesDialog.svelte` metadata/unknown-data setup and Texture Looks undo setter.
- **Docs/gaps:** manual tool sections, terrain/tools/water architecture and `docs/tests/{tools,terrain}.md`
  cover much of this. New-world options, image exchange, growth guards, scoped effects/looks and
  prefab reuse are difficult to discover as tasks; F-017, DOC-006, not separate per-helper pages.
- **Open/deeper:** growth preservation, selection masks across all writers, path reapply/undo,
  chunk slot limits and liquid preservation need focused review. Deeper review necessary.

### S06 — Rendering, world browsing and navigation

- **Audit / documentation:** Broadly Audited (previously Unaudited) / Partial author coverage;
  detailed reference accuracy remains Unverified outside sampled contracts.
- **Features/evidence:** Three.js frame simulation/draw boundary; asynchronous model placeholders,
  retries, worker-built BVH/LOD; animation and particle previews; WMO rooms/fog/visibility/collision;
  sun/moon sky/client lighting/shadows, weather/roofs, liquids/ground effects, streamed World View,
  walkable preview versus server mmaps and path testing. Read `Engine.ts:frame` and beginning of
  `simulate`, `models/assets.ts:loadAsset` fetch/build/error/drop-on-arrival chain, entire
  `models/modelWorker.ts`, `Environment.ts:setClientSky/update`, `WmoRooms.ts:update` initial
  room selection, `Animator.ts` track/pivot matrix construction, `CreaturePreview.svelte:step/show`
  opening, `ParticleLayer.ts` material/texture setup, `WeatherLayer.ts:update` opening,
  `WorldStream.ts` loading model and horizon packing, `NavPreview.ts` ground-change invalidation
  and server tile loading, `nav/navJobs.ts:start` worker/failure dispatch.
- **Docs/gaps:** `docs/architecture/{objects,lighting,terrain,water}.md` and
  `docs/tests/{rendering,terrain}.md` already contain substantial specialist material. Manual
  menu categories are not orientation for preview/server nav, world/region editability, camera
  collision or performance settings. The save guide already mentions World View/Edit Here;
  link/extend it rather than claiming it is undocumented. F-016, DOC-006.
- **Open/deeper:** worker fallback/disposal, shader/cull/shadow gates, WMO floors and coordinate
  frames, preview/server movement fidelity and native WebGL need bounded review; neither nav
  preview nor successful rendering proves server pathing. Deeper review necessary, high priority.

### S07 — UI, browsing and accessibility

- **Audit / documentation:** Broadly Audited / Partial; accessibility behavior Unverified live.
- **Features/evidence:** MenuBar task dispatch, tool options/dock, model/texture/creature/NPC/object
  browsing, favourites/sets, thumbnails/previews, Icons inspector, prefabs, reference image,
  minimap/history, map checks, shortcuts/preferences and dialog keyboard focus. Read MenuBar Tools/
  World/Import-Export and Help actions, `AssetBrowser.svelte` search/per-kind state and set/context
  handlers, `ui/runCommand.ts` day-cycle and dispatch map opening, `ui/dialogFocus.ts` stack/
  tabbables/focus/Tab handling, `IconsWindow.svelte` usage lookup, `CheckMapWindow.svelte:run` and
  `io/prefabFiles.ts:readPrefabs/saveSelectionAsPrefab` setup. Reuse preferences/command evidence.
- **Docs/gaps:** manual, `docs/architecture/ui.md`, `docs/tests/ui.md` cover layout/keys;
  advanced browse/set/prefab/check workflows need focused discoverability, F-017, DOC-006/007.
  Check Map is a finite set of checks, not a compatibility certificate.
- **Open/deeper:** focus/Esc/shortcut conflicts, hidden controls, theme contrast and lazy preview
  resources need targeted tests/probes. Deeper review necessary; no complete accessibility claim.

### S08 — Database and client-table authoring

- **Audit / documentation:** Broadly Audited / Missing consolidated author workflows/readiness;
  dense architecture/check coverage is Partial, not absent. Previously deep children stay Deeply Audited.
- **Evidence/workflow inventory:** the following were sampled in addition to prior completed reviews.

| Family | Major workflows and source bodies read | Deep boundary still open |
| --- | --- | --- |
| Creatures (DB-06) | `CreaturesWorkspace.svelte` wizard setup/steps; `CreatureEditor.svelte` tab/dirty setup, Save and Place; independent Spells/Shop/Quests/Messages tabs | Wizard multi-write creation and independent-save failures; field/picker tests |
| Objects (DB-06) | `ObjectEditor.svelte` find/create and Save ordering; `LootTab.svelte` shared-list read/save | Template then loot then display sounds; shared owners, chest/type conversion |
| Quests (DB-07) | `QuestEditor.svelte` controller, Save and delete opening; `vmangos/quests.go:SaveQuest/DeleteQuest` and free-ID query | Full giver/delete plan/link conflicts and row/giver partial saves |
| Items (DB-04/05) | Reuse completed lifecycle/display/icon/equip/set/dressing investigations; separate Icons inspector sampled in S07 | Inherited lock/page/language lookup and shared cache tests; no repeat item SQL tracing |
| Spells (DB-08) | `SpellEditor.svelte:save/confirmImport`; `SpellVisualComposer.svelte` stages/filter/take; preview sampled in S06 | Visual builder/remap/sound/missile correctness and remaining field/probe reconciliation |
| Spawn topology (DB-09A) | `SpawnFields.svelte` placement handlers, `SpawnActions.ts:editPath/startSpawnPick`, `spawnEdits.ts` field set, `spawnedit.go:serverSpawn`, `pools.go` pool/mother/outside queries | GUID allocation/write conflicts, routes/formations/pools, event visibility versus persistence |
| Linked data (DB-09B) | `ShopTab.svelte` RowList/save/vendor flag; `SpellsTab.svelte` list loading; Loot save; Messages condition deletion/dirty state; `gossip.go:SaveGossipOptions`, `conditions.go:conditionSQL`, `scripts.go:ScriptCommands` | Shared list/menu ownership and copy/delete; conditions/scripts lookup is not a general server-script editor |
| Client tables (DB-09C) | Zones `save` (area/weather), Lights `save`, Portals `save`, Flight Paths editor setup/save route call, World Map image/render import, Ground Effects setup, Texture Looks setter; `app_client_tables.go` result types/area/weather reads and `taxi.go:InstallServerTaxi/installServerDBC` | Each patch/DB/server DBC write and partial failure; sounds/weather, map pictures/overlays, loading screens, scoped/new ground effects |

- **Docs/gaps:** manual menu map, `docs/architecture/client.md`, `docs/tests/spawns.md` and
  `docs/tests/client.md` already explain many contracts/checks. Authors still lack one safe
  setup/create/edit/save/export/import/refresh path per family and a destination/undo map for World
  dialogs. F-003/007–013 remain; F-018 extends DOC-004 instead of duplicating it. DOC-012 covers readiness.
- **Open/deeper:** independent tab saves, shared records, quest deletion and DB/patch ordering
  need prioritized bounded reviews before guide implementation. Do not imply a transaction undoes
  all writes or that cancelling a parent reverses immediate actions. Deeper review necessary.

### S09 — Compile, publish and recovery

- **Audit / documentation:** Broadly Audited / Partial; WR-01/02/03 stay Deeply Audited.
- **Features/evidence:** compile client/server/all, spawn-only save, new-world publish, queued
  patches/overlay, backups, extractor staging and mmaps. Reuse completed backends/callers; read
  `vmangos/export.go:ExportMap` validation/Map.dbc/tile/UID setup,
  `region.go:BuildRegion` validation/WMO-only entry and
  `publish_chain_test.go:TestPublishChain` setup/order assertions. This does not complete WR-04.
- **Docs/gaps:** save/compile guide, troubleshooting, terrain/client references and client recipes
  useful; F-011/014/015 platform/restart/partial-recovery corrections remain DOC-005/009.
- **Open/deeper:** full tile/region serialization, legacy unknown fields, border IDs and complete
  publish-chain failure ordering remain highest-priority deep prerequisites. No extractor run.

### S10 — Lua scripts and brushes

- **Audit / documentation:** Broadly Audited / Partial; existing API prose already substantial.
- **Features/evidence:** one-shot scripts and retained brush sessions; base/table/string/math Lua
  libraries, time limits, map host, noise/images, terrain/model/chunk/liquid changes and script storage.
  Read `luaRun.ts`, `scriptApi.ts:ScriptSession.load/event/openScript/runScript` samples,
  `Engine.ts:runScript`, `engine/ScriptRun.ts` host state and
  `scriptBrush.svelte.ts` bounded log/session state; scripts folder/name contract reused.
- **Docs/gaps:** manual scripting section, `docs/architecture/scripting.md`,
  `docs/tests/scripting.md` cover API/limits; all examples/events/units and partial-error undo remain
  to reconcile under DOC-008. DESIGN's historical non-goal stays DOC-010 Deferred.
- **Open/deeper:** host finish after returned errors, brush cancellation/timeouts and image path/
  size restrictions need selected tests; no example or script executed. Deeper review necessary.

### S11 — Checks, probes, profiling and meldtool

- **Audit / documentation:** Broadly Audited / Partial, not an absence of testing guidance.
- **Features/evidence:** short/full Go/Bun checks, fuzz seeds/mutation, read-only client discovery,
  opt-in DB tests, shared-backend probes/sandbox, standalone WebGL pages, scene replay, screenshots,
  SwiftShader/real-GPU performance. Read `cmd/meldtool/main.go:run/dispatch`, bindings flags and
  `mpq.go` optional local output; `frontend/package.json` scripts; probe runner argument and
  stale-backend/dev-autostart bodies, `guard_test.go` guard map/limitations, standalone
  `tests/browser/terrain.html` render/readPixels/error reporting. No commands from those runners ran.
- **Docs/gaps:** `docs/TESTS.md` and browser README already describe safety and harness distinctions;
  keep them canonical. F-010/014 recipe corrections and selective recipe reconciliation stay DOC-009.
  Read-only meldtool means no client/server mutation, not that `mpq cat -o` cannot write a local file.
- **Open/deeper:** guard helper-call limits, probe isolation/capabilities and machine-specific
  baselines require targeted reconciliation, not exhaustive live runs. Deeper review necessary.

### S12 — Builds, bindings and distribution

- **Audit / documentation:** Broadly Audited / Partial; native/package operation Unverified.
- **Features/evidence:** OS build targets, generated bindings/checks/notices, frontend/docs scripts,
  VitePress Pages deployment, NSIS scope/WebView2/shortcuts/associations/uninstall and optional Rust
  launcher build seam. Read Makefile target bodies, package scripts, docs workflow, NSIS install/
  uninstall tail and `benilla-launcher/build.rs`; reuse launcher manifest/source review.
- **Docs/gaps:** development/build README/BENILLA sufficiently orient current artifacts; Windows/
  Linux native setup, installer behavior and sibling launcher packaging need DOC-011, not new
  release/macOS promises. A Pages deployment is not an application release pipeline.
- **Open/deeper:** actual installer effects, generated-binding parity and Rust/sibling artifact/
  dependency attribution closure need review. No NSIS/Wails/Rust build or external checkout read.

### S13 — Game launch, character placement and Benilla

- **Audit / documentation:** Broadly Audited / Partial overall; existing core prerequisites sufficient.
- **Features/evidence:** launch/Play Here, unsaved compile checks, character placement/SOAP, game
  process/window/login and cache refresh. Reuse GAME-01/02/03 and prior GAME-04 source/test evidence;
  sample `probes/compile-launch.js` menu/fingerprint setup and its declared refusal-check scope,
  `probes/world-view.js` ground/load assertions, and `walk-wmo.js` floor setup. Probe reading did
  not launch anything and does not finish GAME-04; source-reviewed floor/streaming dependencies are S06.
- **Docs/gaps:** BENILLA, save/compile guide, troubleshooting and `docs/tests/client.md` cover
  normal setup; floor/frame assertions and optional native/sibling build verification remain
  DOC-005/011, not a duplicate launch guide.
- **Open/deeper:** camera-to-server floor/frame correctness and real logged-in/logged-out failures
  remain unverified. Deeper bounded reconciliation necessary; no client/account configuration read.

### S14 — Licences, provenance and operator workflows

- **Audit / documentation:** Broadly Audited / Unverified attribution completeness; DESIGN's known
  Lua section Outdated, generic operator instructions already present.
- **Features/evidence:** permissive dependency policy/port provenance, generated notices, owner
  approval and owner-question notification, issue templates, docs publishing. Read notices generator
  allow-list/input and final check/write branches, notices' Benilla/port introduction, CLAUDE
  conventions/workflow sections and tracked `.github/workflows/{approve,ping-owner,docs}.yml`
  plus bug/feature/config template samples. These files describe operations; no automation ran.
- **Docs/gaps:** `THIRD_PARTY_NOTICES.md`, `CLAUDE.md`, `docs/DESIGN.md` and reference index
  cover intended audiences; no separate operator manual justified. Owner-only approval rules and
  historical Lua drift must stay distinct from current product capability; DOC-010 remains Deferred.
- **Open/deeper:** optional launcher Rust attribution versus npm/Go generator scope and external
  decision provenance are questions, not proven licence defects. Deeper distributor review under
  DOC-011 is useful; legal completeness and remote decisions were not verified.

### F-016 — Rendering and navigation need author orientation, not more internals

- **Evidence:** Engine/model/room/environment/nav/streaming bodies in S06 and menu actions expose
  distinct workflows; manual has Show/Graphics/Lighting category rows, while architecture terrain/
  objects/lighting and rendering recipes contain the operational detail. The save guide already
  identifies read-only World View/Edit Here; that coverage is Partial, not Missing.
- **Gap/disposition:** explain/link preview nav versus server mmaps, Test a Path, walk/collision,
  client lighting and performance/display choices in existing author entry pages. DOC-006 P2
  refined; verify deep boundaries before implying fidelity. No confirmed shader/product defect.

### F-017 — Generation, growth and reusable exchange lack task-level coverage

- **Evidence:** image/list/prefab IO, generator/growth bodies and menu actions expose height/normal/
  water/alpha images, object lists, brush/model sets and selected-model prefabs. Image heights use
  explicit yard ranges and operations; prefab files refer to assets; growth is not arbitrary resize.
  Manual lists Import/Export categories but has no corresponding end-to-end exchange instructions;
  architecture terrain/tools and tests carry much of the specialist explanation.
- **Gap/disposition:** extend existing manual/getting-started sections with scope, dimensions/units,
  file versus patch destinations, asset dependencies and growth prerequisites. Keep preview, Apply,
  undo, Save and compile distinct. DOC-006 P2 refined; DOC-005 retains preservation guarantees.
  Do not create a page per format or claim a portable prefab bundles client assets.

### F-018 — World dialogs and linked editors need a persistence/ownership map

- **Evidence:** creature tabs save independently; object Save writes template/loot before sounds;
  quest Save writes row before givers; Zones saves area/weather, Lights writes patch params,
  Portals reports optional server writes, Flight Paths also installs server DBC copies. Ground
  effect choices/Texture Looks are map undo edits, unlike creating a client-table effect. These
  distinct boundaries are visible in sampled UI/backend code; complete error semantics are not proven.
- **Gap/disposition:** DOC-004 P1 refined to include this client-table/linked-data inventory and
  shared-row/partial-save cautions; use DOC-005 for cross-write recovery and DOC-012 for readiness.
  Existing dense architecture/regression prose is valuable, but menu listings are not author tasks.

### Backlog reconciliation and next phase

- No duplicate DOC tasks created; refined DOC-004/006 with F-016–018, DOC-008 with script error/undo
  reconciliation, DOC-009 with harness limits, and DOC-011 with installer/launcher/notices scope.
- DOC-005 remains first P1 for write/recovery correctness, then DOC-012 database readiness and
  DOC-004 authoring. DOC-006/008/009/011 remain P2, DOC-007 stays P2, DOC-010 stays P3 Deferred.
- Prioritized deep-audit units DA-01–07 are defined in roadmap section 9. They are recorded, not
  executed here. No new P0 established by this pass; broad sampling cannot rule out deeper defects.
- No guide, site navigation, application source, fixture or generated binding was changed. No
  documentation implementation, commit, branch, issue submission or remote policy verification.

### Session-4 management validation

- **Passed:** `cd frontend; bun run docs:build`; VitePress built/rendered site pages. Existing
  non-failing warning for chunks over 500 kB remains. Root management files are not site pages.
- **Passed:** all 16 local Markdown link/anchor checks across the three management files; one
  H1 per file, no trailing whitespace/NUL, 14 parent rows marked Broadly Audited, no Unaudited or
  Not inspected current rows, and all 12 unique DOC IDs retain required task fields.
- **Passed:** `git diff --check`; independent text checks include the untracked management files,
  which normal git diff omits. SHA-256 comparison of all 1,146 tracked files against the session
  start found no changes, preserving every preexisting guide/navigation modification.
- Only the three management files were edited. The preexisting untracked settings guide and
  operator files were not edited. No application-source change or backlog implementation.
- No application tests, native build/installer, browser/navigation/search/accessibility validation,
  live game/server/database/extractor, external licence/provenance check or probe was attempted.
  Earlier sessions’ test counts are historical, not this session’s results.

## Prioritized deep audits — 2026-10-28, session 5

### Authorization, risk order and evidence boundaries

The new request explicitly authorizes DA-01–DA-07 investigations, not documentation implementation.
HEAD remains `98e7a4d69a3d3b65f313a2589afa21516aaec52a`. DA-01 write/preservation is first;
DA-02 destructive/shared authoring and DA-05 DB/client visual-save dependencies precede rendering.
DA-06 recovery safety follows, then bounded DA-04 exchange/growth, DA-03 fidelity and DA-07 native
packaging/provenance checks. This order favors P1 correctness, irreversible writes and onboarding.
Previously finished WR-01/02/03, DB-01/02/03, item core/dressing, spell starters and game-session
reviews were reused, not restarted. Existing docs were compared in relevant sections, not reread
as if every reference or historical recipe were verified. No native/live operation was authorized
or performed. Only focused tests known to use synthetic/temp data were selected.

### DA-01 — Complete for documentation-critical write and preservation questions

- **Questions answered:** what region/new-world writes happen first; what survives older working
  files; which neighboring tiles/IDs change; what remains after later failures; whether no-change
  compile implies all DB/server work is current.
- **Source reviewed:** `internal/vmangos/export.go:ExportMap`; `internal/vmangos/region.go:BuildRegion` ownership/UID allocation,
  headers, changeLiquids/PartialLiquids, outside-tile rewrites and normals; app_region.go:SaveRegion;
  frontend/src/lib/io/compile.ts, Engine.ts export/regionLiquids, io/vmangosExport.ts optional
  headers/holes and io/mapData.ts:fromMapData; internal/mapfile/version_test.go fixture contract.
  publish_chain_test.go setup/locked case and ordering assertions were sampled, not every assertion.
- **Verified from source:** new-world ExportMap installs client files before the server Map.dbc
  copy; Publish's server map-table/SQL/extraction steps are later independent boundaries. A later
  failure is not all-installation rollback. Region Compile All saves the client first, then spawns
  when configured, then rebuilds server data. A caught spawn failure leaves client output and skips
  rebuild. Server-only compile refuses client-uncompiled input and saves spawns before rebuild.
  Unchanged client output may still save spawns; it does not automatically rebuild stale server data.
- **Legacy preservation:** v1–7 reads carry unknown holes/liquids/chunk-data states into later saves.
  Unknown holes export additive nonempty masks; known holes can explicitly clear. Unknown header
  fields are omitted; areaId 0 alone is not permission to erase absent metadata. Partial liquids
  skip chunks absent from desired layers, preserving client liquid there; they are not a promise
  that every unknown layer can be individually edited. Unpainted chunks retain client alpha.
- **Border effects:** bounds can require files outside the editable block, shared placement IDs
  across touched tiles and map-wide allocation avoiding preserved IDs. Neighbor normal rewrites
  can also extend the changed-file list. A no-edit first compile need not be byte-identical to the
  original client, because serialization normalizes subchunk order.
- **Tests:** 13 selected vmangos chain/region tests, mapfile TestFixtures and 27 frontend migration/
  export tests passed. Temporary synthetic archives/fake runners exercise sequencing/preservation;
  this does not establish fidelity in a real 1.12 client, power-loss durability or external tools.
- **Documentation comparison:** docs/guides/saving-and-compiling.md already separates working file,
  client and server and correctly says no automatic game/server restart. docs/tests/client.md write
  chains, paint/border recipes and normalization warning are useful and consistent in this sample.
  F-011/014/015 remain the actual known corrections; add legacy/border/partial-result cautions to
  DOC-005 rather than a new guide. DOC-005 is Ready; exhaustive serializers and native compatibility
  stay unverified and must be stated as such. Do not promote all WR-04 helpers to Fully inspected.

### DA-02 — Complete for documentation-critical authoring questions

- **Source reviewed:** app_client_tables.go:SaveAreas/SaveAreaTriggers/SaveTaxi/SaveLights,
  AddGroundEffect/WriteWorldMap/WriteLoadingScreen; app_pending.go:installClient; app_editors.go
  display-sound save; internal/vmangos/quests.go giver/delete SQL and planner; gossip.go text/menu/
  option construction, loot.go named-list writes, vendor.go direct/inherited rows and
  creaturespells.go:creatureSpellsSQL; CreatureEditor/ObjectEditor Save bodies, LootTab ownCopy/save,
  SpellsTab independent save and QuestEditor delete confirmation. Focused SQL/test bodies reviewed.
- **Ownership:** editing a shared creature spell list creates a new list for this creature; shared
  gossip menus/options are copied and changed greeting text gets new text rows. Object loot is
  different: SaveObjectLoot replaces the named list; it does not automatically make a private copy.
  LootTab's explicit ownCopy allocates an ID and changes the pending template/list, then Save keeps
  it. Direct vendor rows and inherited vendor-template rows are distinct; do not promise a direct
  Shop save edits the shared vendor template. Object display sounds are client display-wide data.
- **Save/undo boundaries:** creature base Save does not invoke Save spells; that tab updates its
  pointer independently. Object Save commits template changes first, then contents, then display
  sounds. A later failure does not undo earlier writes. Revert/map history is not a DB/patch undo.
  This refines F-009/F-018, not a claim that every related editor has identical ordering.
- **Destination map (source-only except named synthetic tests):**

| Family | Destination / ordering / scope |
| --- | --- |
| Zones and portals | Weather/trigger SQL first when required; changed AreaTable/AreaTrigger DBCs afterward. Patch failure after SQL returns an afterDatabase retry message; not a transaction across DB/client. |
| Flight Paths | Taxi SQL first; queue/install changed TaxiNodes/TaxiPath/TaxiPathNode DBCs, then server DBC-copy callback. installClient calls the callback even if client output is waiting. Server copies can advance before the game sees queued data and can fail after DB/client output; no multi-file rollback promise. |
| Lights | Changed light DBCs to client patch/pending path; no server SQL. |
| World Map and loading screens | Generated art plus relevant DBC rows to client patch/pending path; dialog Write is not map Undo. World Map includes exploration overlay art/rows. |
| New ground effect | New GroundEffectTexture DBC row referencing existing client doodads; patch write is independent of saving/compiling the map's use of the ID. |

- **Tests/docs:** 13 selected SQL/visual/Taxi tests and the root partial-failure test passed; visual
  evidence belongs to DA-05 too, not an extra execution. docs/architecture/client.md and
  docs/tests/client.md already explain spell DB-first/pending and afterDatabase recipes; preserve
  them. Missing author-facing ownership and immediate-write cautions refine F-018/DOC-004, not
  duplicate tasks. No live DB transaction, queue timing or game refresh was executed.
- **Final P1 blocker closure:** CreaturesWorkspace.svelte equipment effect/make, templates.go
  createTemplate/CreateCreature, equipment.go:EquipmentFor, app_spawns.go:ApplySpawnEdits,
  spawnids.go:CheckCreatedGUIDs, spawnedit.go:runScript, sql.go:ExportSQL path/group/pool sections,
  formations.go:formationSQL, pools.go membership/mother/ID builders, SpawnActions allocation/
  history/save baseline and SpawnLayer edits/markSaved reviewed. Named SQL/group/collision test
  bodies and focused fake-host assertions were compared with client architecture and spawn recipes.
- **Wizard:** held-item preview calls EquipmentFor before Make creature; a new equipment
  combination can write an equipment row even if the wizard is cancelled. make performs
  CreateCreature, ReadCreature, then SaveCreature in separate calls. A later read/update failure
  leaves the created defaults row; retry is not an atomic resume and can make another entry.
  IDs use DB maximum+1, not an independently reserved global range. Existing spawn-check docs
  already warn that EquipmentFor may write; preserve that warning and add it to DOC-004 rather
  than trusting the source comment that nothing is written until Make.
- **Spawn save:** route/pool/formation edits are local history until Save Spawns/Compile Server/All.
  Changed paths replace this spawn's path_id 0, not its shared template path. Formation leader
  deletion/disband can delete member rows outside the region. Pool limit/name updates affect
  every patch row of the shared pool; master changes affect pool_pool and shared master limits.
  UI changes to loaded members do not confine those SQL effects to the open region.
- **Allocation/failure/recovery:** GUID candidates account for open tabs and DB state; the
  precheck refuses collisions observed before ApplySQL, not an atomic reservation. The created
  INSERT avoids deleting a different entry if a GUID was taken; simultaneous DB writers are not
  certified safe. ApplySpawnEdits attempts a cached SQL record before execution, but ignores
  mkdir/write errors: it is best-effort evidence, not a guaranteed backup or inverse undo script.
  runScript wraps SQL and returns failure, but MyISAM writes are not made rollback-safe by
  START TRANSACTION. Successful frontend Save marks the baseline and reports skipped portions;
  errors do not mark it saved, but earlier nontransactional statements may already have applied.
  Restart messages are source-verified, not a live server-refresh test.
- **Closure:** nine more synthetic Go tests and 11 fake-host spawn tests passed. All P1
  documentation-critical questions in DA-02 are answered or explicitly limited; DOC-004 is Ready
  for representative author workflows with these cautions. Live DB concurrency/engine failure,
  Svelte interaction and every advanced editor control remain unverified, not promises or
  blockers to source-backed documentation. Broad child labels remain partial, not exhaustive.

### F-019 — Quest-delete preview is not a rollback or a locked deletion plan

- **Observed gap:** the authoring inventory names quest deletion but has no consolidated caution
  explaining all-patch/link effects versus retained player quest status. This is a missing safety
  explanation, not a claim that existing developer prose promises transactional deletion.
- **Evidence:** quests.go:PlanQuestDelete reports current counts/links and character status when
  readable (-1 when unavailable). QuestEditor confirms, then calls DeleteQuest by entry rather
  than submitting a frozen plan. DeleteQuest checks existence and constructs current delete SQL.
  deleteQuestSQL removes all quest patch rows, giver/event/locale links and unshared start/end
  scripts, clears links in other quests, and does not delete character_queststatus. The SQL unit
  test passed; it is not a concurrency/MyISAM rollback or actual player-state test.
- **Impact/action:** DOC-004 must explain stale preview counts, unknown player counts, all-patch
  scope and retained character status; back up the DB, do not promise Undo. This P1 safety
  clarification fits the existing task and Ready quest slice; no duplicate DOC ID or live deletion.

### DA-05 — Complete for reference and visual-save documentation questions

- **Source reviewed:** objecttables.go:LoadObjectTables/lockInfos/firstLine, quests.go:loadQuestDBC;
  refNames.ts object/quest caches, batch flush/refName/rememberName/forgetName; spellvisuals.go
  table-schema checks/readVisualDesign/planVisual/planSpellVisualFiles; spells.go:PlanSpellSave and
  app_spells.go:SaveSpell/CreateSpell; SpellVisualComposer stages/take/apply/filter; selected
  spellFields/objectFields assertions and spell-visual probe body. Reused earlier field algorithms,
  starter and portable-look reviews instead of retracing them.
- **Answers:** object lookup needs ten client tables as one batch, not independent optional tables.
  Quest sort/skill/faction/mail lookup similarly loads its four-table set. Lock type 1 is an item
  key, type 2 a lock type/skill; a page is a lookup named by stripped/truncated first-line text,
  not a page editor. A missing reference/name is not proof the stored numeric ID is invalid.
  refName caches promises including null/error fallbacks until forgotten/remembered; rejected
  table-list promises reset for retry. No direct refNames batching/cache unit test was found in
  frontend/tests; do not claim retry/invalidation was exercised in Svelte or across client changes.
- **Visual contract:** composer Use this visual updates the pending design, not the patch. Save
  plans data before writes, reuses unchanged/equal visual rows, and appends changed kit/visual rows
  rather than changing other spells' stock rows. Base kit non-effect fields are retained; borrowed
  missile/area source fields carry their path/attachment/sound, not asset bytes. Missing visual IDs
  read as empty designs; invalid table layouts fail. These are client-table composition rules, not
  evidence that arbitrary asset combinations look or sound correct in game.
- **Write order:** SaveSpell/CreateSpell run DB SQL, request spell reload, then save client files;
  client failure explicitly says the DB is already saved and to Save again. Waiting overlays feed
  the next plan. Different from the already verified item-display-before-DB case F-009. No promise
  of cross-destination atomicity or that a loaded game sees new Spell.dbc without restarting.
- **Tests/docs:** TestPlanVisual and four lock/name SQL tests pass; frontend spellFields (7) and
  objectFields (3) pass within the 53-test batch below. docs/architecture/client.md's composer/
  DB-first account and docs/tests/client.md object-picker recipe agree with the checked code.
  spell-visual probe explicitly never presses Save; its source is read, not executed. Actual GPU
  model/effect/sound/missile preview and stock-layout/client compatibility checks remain unexecuted
  DA-03/runtime scope. Questions are classified, so DA-05 can close without claiming all DB-08
  static internals Fully inspected. DOC-004 has sufficient evidence for this slice.

### DA-06 — Recovery and Lua safety subset, not full lifecycle/harness closure

- **Source/tests:** recovery.go multipart staging, Save/info-last, Drop/End/list contracts and all
  six recovery test bodies/run; io/recovery.ts autosave timing, busy/stroke skips, encoding abort,
  clean-quit/drop and recover; io/session.ts:quitNow, app.go shutdown/close policy; sessionlog.go
  Keep/prune/Append/Read. scriptApi.ts load/event/time-limit/error conversion and Engine.runScript/
  ScriptBrushes finish/failed-event paths were compared with docs/architecture/scripting.md and
  docs/tests/scripting.md. luaScript/scriptGround tests passed with fake hosts and Lua WASM.
- **Answers:** dirty tabs wait their configured interval; unchanged/history-stale or mid-stroke
  copies are skipped/retried rather than a guaranteed last-keystroke backup. Multipart fields
  remain in memory until Save and abandoned parts are dropped; info is written last, but that is
  not a universal filesystem-crash atomicity guarantee. Clean File Quit drops this session's
  copies after preferences/session work; shutdown End retains copies otherwise. Recover opens an
  unsaved map, may reuse a matching clean tab, drops that recovery copy and requires Save to keep
  it. Failed copy/log IO does not constitute durable backup evidence.
- **Lua boundary:** script errors can retain earlier edits in the one finished history command;
  brush events are serialized and a failed stroke stops further events, then release finalizes
  the command. The script/event time limit is not automatic rollback. Existing scripting docs
  already explain this; do not create a duplicate warning task or claim Engine/UI undo executed
  merely because fake-host API and ground-command tests passed.
- **Harness:** run.mjs defaults nosave/nosession/defaults, timeout/GPU options and header selection
  were sampled; autosave probe source demonstrates actual backend use. These flags do not make
  every Go binding harmless. No probe ran and no guard/cleanup completeness is asserted.
- **Remaining:** startup/restore failures, delayed close/bridge failures, log error presentation,
  full prelude/examples, probe refusal/timeout/sandbox cleanup and CLI guards need focused reviews
  under DOC-008/009. Existing settings/data storage coverage remains sufficient; DOC-005 safety
  corrections need not wait for this P2 completeness work.

### DA-04 — Migration, growth and exchange preservation subset

- **Source/assertions:** io/worldGrow.ts:growSnapshot, io/heightmapImport.ts, io/prefabFiles.ts,
  tools/pathApply.ts edit recorders/applyPath/fillRiver/fence and relevant test cases. Earlier
  migration/export tests count once under DA-01. All 23 heightmap/prefab/path tests plus the three
  growth tests passed. Growth preserves old arrays, holes/headers/shadows/liquid chunk indices,
  shifts roots/paths/scoped effects but not parent-local attachments, and leaves the input alone;
  the caller must update the map reference/grid origin. Picked export tiles exclude absent tiles.
- **Exchange limits:** heightmap grey-to-height range is mapped by Set/Add/Subtract/Multiply and
  bilinear resampling; per-tile import preserves shared boundary vertices. Prefab TOML carries
  model paths/transforms/parent links, not bundled client assets; malformed model roots drop their
  dependents. Tests prove synthetic representation behavior, not every image codec/client asset.
- **Paths:** Apply writes immediately and returns a command for the changes, not a live modifier.
  Rivers carve ground and fill liquid with undo for both; texture-slot refusal can leave a path
  applied without all paint. Fences add placements per apply; a safe reapply workflow needs caller/
  UI reconciliation rather than a promise of idempotence. docs/architecture/terrain.md and
  water.md and their recipes remain useful references, but F-017's task-level gaps remain.
- **Remaining:** generator seed/scope and masks/liquids, repeated Apply/UI state, image/model-list
  exchange end-to-end and Check Map/focus details. Continue within DOC-006/007; do not re-open the
  already tested migration/growth boundary without a changed claim.

### DA-03 — Bounded navigation evidence; real rendering fidelity remains open

- **Source/assertions:** world/nav/navServer.ts frame/parser/flags, navJobs.ts start/failure/stop,
  NavPreview.ts buildTile result-generation checks and fallback; WmoRooms synthetic room-test
  cases compared with docs/tests/rendering.md WMO-room recipe. Three navServer and five wmoRooms
  tests passed. Synthetic Detour build/readback/path checks use Recast WASM and
  made-up geometry; they do not read a running server's current movement map.
- **Answers:** server mode reads stored mmaps, whereas local preview builds from editor geometry;
  coordinate transforms round-trip in the selected synthetic case, not a certificate of current
  server/game agreement. Worker failures disable workers and reject jobs; stale results are
  ignored and live failures allow main-thread requeue. This fallback was source-inspected only:
  Bun has no browser Worker/WebGL frame. Room tests cover indoor/roof/hidden cases, not every WMO.
- **Remaining static questions:** model decode-worker/LOD/animation resource cleanup, environment/
  weather/shader/shadow and streaming/ground/liquid limitations. **Blocked runtime questions:**
  actual worker failure/rendered fallback and floor/cull/game fidelity need an authorized native
  app with representative client assets and coordinated in-game comparison. DOC-006/009 and
  GAME-04 retain those limits; do not claim live preview equals authoritative server collision.

### DA-07 — Source packaging boundary; external verification classified

- **Inspected:** Makefile native/cross build targets; NSIS project.nsi installation/uninstall and
  wails_tools.nsh selected architecture/file/scope/registry/WebView2/association macros; launcher
  Cargo manifest and build.rs; notices.mjs npm closure/Go build graph/output/check logic. Compared
  build/README.md, docs/development.md and existing Benilla build/runtime limitations; no native
  build, notice regeneration or installer ran.
- **Answers:** NSIS scope selects user/system path and registry handling; WebView2 checks registry
  then invokes the bundled bootstrapper if needed. This is not an offline installation guarantee.
  Makefile Linux tags/cross Windows build do not certify native startup. Launcher has sibling
  Benilla path dependencies/patches and buildstamp provenance; the exact distributable sibling
  revision is not pinned by merely reading Meld's revision. notices.mjs enumerates npm runtime
  closure and Go modules and checks installed npm tooling; it does not enumerate Cargo's closure.
- **Blocked follow-up:** distributor must identify which optional launcher/assets are shipped and
  the corresponding sibling revision/attribution boundary. Native Windows install/uninstall and
  Linux WebKitGTK/runtime need disposable native hosts and authorization. No inferred missing
  licence violation, legal completeness, release availability or macOS support claim. DOC-011
  stays Todo; source-backed precautions are Ready slices, native/distribution certification is not.

### F-020 — NSIS uninstall removes the whole installation directory

- **Evidence/gap:** project.nsi uninstall uses recursive removal of the chosen installation
  directory as well as WebView2 data, shortcuts and association cleanup. Existing build guidance
  distinguishes tracked inputs/output but does not explain this installer-specific author-data risk.
- **Action:** refine DOC-011 with a precaution not to select a directory containing maps/client/
  server/other author data for installation. This is source-verified, not an executed uninstall or
  a claim about every platform package. No recursive deletion was performed during this audit.

### Documentation readiness and handoff

- DOC-005, DOC-012 and DOC-004 are Ready after the final wizard/topology review. No P0 or
  P1 task remains Needs Investigation or externally Blocked for the named documentation scope.
  DOC-001/002 Done evidence retained; no task changed to Done based on investigation alone.
- First implementation batch, only after permission: correct DOC-005 known platform/restart and
  partial-write/recovery statements; add DOC-012 canonical diagnostics; then implement DOC-004
  representative workflows including the verified wizard/spawn safety boundaries. Do not delay these for unrelated renderer or
  packaging certification. Keep whole DOC-004 open until all acceptance is satisfied.
- Remaining audit order: DA-06 lifecycle/guard recipes, DA-04 generator/masks/exchange; DA-03 static limits and authorized fidelity checks, DA-07 native/distributor
  evidence. Existing IDs preserved, overlaps merged into F-018/DOC-004/005/006/008/009/011/012;
  no duplicate DOC task or application fix created. DOC-010 remains Deferred/owner-approved only.

### Checks executed — session 5

All application checks below are isolated synthetic/temp fixture/unit tests, with no skips. Commands
are recorded as executed, not recommendations to run arbitrary live suites. From repository root:

```powershell
go test ./internal/vmangos -run '^(TestPublishChain|TestPublishChainLockedPatch|TestRegionNoEditRoundTrip|TestRegionHolesRoundTrip|TestRegionLiquidsUnchanged|TestRegionPaintRoundTrip|TestRegionLiquidsRoundTrip|TestRegionBorderModelsInEveryTile|TestRegionBorderModelsOutsideBlock|TestRegionAddedModelsGetMapWideIDs|TestRegionHeadersWritten|TestRegionUnpaintedChunksKeepClientAlpha|TestRegionNormalsReachTheTilesBeside)$' -count=1 -v
go test ./internal/mapfile -run '^TestFixtures$' -count=1 -v
go test ./internal/vmangos -run '^(TestDeleteQuestSQL|TestQuestRelationsSQLKeepsPatchesAndRefusesDuplicates|TestGreetingSQLNeverEditsSharedText|TestOptionsSQLNeverEditsSharedText|TestCheckGossipOptions|TestLootSQLReplacesTheList|TestLootSQLRefusesBadRows|TestSetTaxiUnchanged|TestSetTaxiEditsAddsAndRemoves|TestSetTaxiRefuses|TestTaxiSQL|TestInstallServerTaxi|TestPlanVisual)$' -count=1 -v
go test . -run '^TestSaveAfterDatabaseSaysWhatWasWritten$' -count=1 -v
go test ./internal/recovery -count=1 -v
go test ./internal/vmangos -run '^(TestLockInfos|TestTaxiAndCinematicNames|TestWorldRefSQL|TestFirstLine)$' -count=1 -v
```

Results respectively: 13, 1, 13, 1, 6 and 4 Go tests passed (38 top-level tests, no skips).
Final DA-02 closure also ran from root:

```powershell
go test ./internal/vmangos -run '^(TestCreateCreatureSQL|TestSpawnIDQueries|TestGUIDCollisions|TestExportWritesAChangedPath|TestFormationSQL|TestPoolSQL|TestMotherPoolSQL|TestRunScriptWrapsATransaction|TestNoScriptBuilderOpensATransaction)$' -count=1 -v
```

All nine passed: **47 Go top-level tests** total for session 5, no skips.
From frontend/:

```powershell
bun test ./tests/mapData.test.ts ./tests/vmangosExport.test.ts
bun test ./tests/worldGrow.test.ts ./tests/navServer.test.ts ./tests/wmoRooms.test.ts ./tests/spellFields.test.ts ./tests/objectFields.test.ts ./tests/luaScript.test.ts ./tests/scriptGround.test.ts
bun test ./tests/heightmapImport.test.ts ./tests/prefabs.test.ts ./tests/paths.test.ts
```

Results respectively: 27 (103 expectations), 53 (180 expectations) and 23 frontend tests passed
(103 tests, no skips). Final DA-02 closure also ran from frontend/:

```powershell
bun test ./tests/spawnActions.test.ts ./tests/spawnLayerEdits.test.ts
```

All 11 passed: **114 frontend tests** total for session 5, no skips. These include fake-host
GUID/pool allocation and synthetic edit/save/history sequences, not a real DB.
One initial worldGrow Bun command from the repository root matched no
files and exited 1; it was corrected to frontend/ and passed in the 53-test batch, not counted as
an application test failure or pass. Fixture tests were read-only; no -update or live environment
variables/probes were used. Native app/game/DB/extractor/installer/worker/GPU behavior remains
unexecuted. The existing non-failing large-chunk warning is not a runtime verification failure.


### Session-5 management validation

- **Passed:** 47 focused Go top-level tests and 114 frontend tests, no skips. This is synthetic/
  fake-host evidence only; the initial wrong-directory Bun filter matched no files and was rerun
  correctly. No live/game/DB/probe/native build or destructive operation was performed.
- **Passed:** cd frontend; bun run docs:build. VitePress built/rendered pages; the existing
  non-failing warning for chunks over 500 kB remains. Root management pages are not site pages.
- **Passed:** 16 local Markdown link/anchor checks; one H1 per management file, balanced fences,
  no NUL/trailing whitespace; 12 stable DOC IDs with all required fields; 14 parent rows still
  Broadly Audited. DA-01/02/05 Complete and all three open P1 tasks Ready, separately from Todo.
- **Passed:** git diff --check and SHA-256 comparison of all 1,146 tracked files with session-start
  hashes: no tracked file changed, preserving every preexisting guide/navigation modification.
  Only the three management files were edited; no guide/fixture/application/binding/notices change.
- **Not attempted:** browser/navigation/search/accessibility, actual Worker/WebGL/GPU behavior,
  real-client compatibility, DB concurrency/engine rollback, external extractor or native
  installer/Linux/sibling-launcher runtime and complete third-party provenance review. These are
  explicit limits, not passing checks. No documentation implementation, commit or background work.


## Documentation implementation — 2026-10-28, session 6

The user authorizes implementation of Ready backlog tasks, starting DOC-005/012/004, then further
actionable work while context allows. Source baseline remains `98e7a4d69a3d3b65f313a2589afa21516aaec52a`.
Start hashes preserve 1,146 tracked files and the existing untracked settings guide. No new
repository AGENTS.md found. Preexisting documentation edits are retained. No application source,
fixture, generated binding, live database/game/probe/server or native installer operation is allowed
by this documentation pass. Earlier audit evidence is reused, not counted as new runtime checks.

### DOC-005 — Completed

- Updated saving-and-compiling guide, troubleshooting, client architecture and export regression
  recipe. Preserved existing steps/launch separation; added client→spawn→server failure order,
  neighboring-tile writes, old-format unknown metadata, persistent queues/Linux gate, limited
  patch/recovery copies, extractor staging versus replacement, optional movement-map failure and
  untouched mmap.enabled. Added author-facing cache-pruning limitations and partial-write recovery.
- Source rechecked: app_pending.go:gameRunning/installClient, publish/mapio orchestration,
  vmangos install/pending constants and extractor code plus existing DA-01/02/05 evidence. F-011/014
  corrected in canonical architecture/recipes; F-009/013/015 limits explained without promising rollback.
- Passed: four selected vmangos tests (TestPublishServerKeepsTheOldDataOnFailure,
  TestUpdateServerMapsNeverStopsOrStartsTheServer, TestRegionHolesRoundTrip,
  TestRegionLiquidsRoundTrip) and root TestSaveAfterDatabaseSaysWhatWasWritten; all synthetic, no skips.
  cd frontend; bun run docs:build passed (existing >500 kB chunk warning). Ten local links/anchors
  across four changed pages passed; git diff --check passed. No live client compatibility or browser check.


### DOC-012 — Completed

- Added canonical database readiness/error/startup checklist to troubleshooting and linked it from
  getting started. Covers both configured folders, executable named mariadb on inherited PATH,
  five-field WorldDatabase.Info in run/mangosd.conf, SQL versus Game Login credentials, redaction,
  error-specific diagnosis, read-triggered Windows startup/my.ini/adjacent daemon/30 s retry and
  Linux-managed service. No blanket privilege grants or real credentials in examples.
- Rechecked confDatabase/worldDatabase, runSQL/mariadbError, ensureDatabase/databaseProgram and
  app serverAndData/serverForWrite gates. TestConfDatabase and TestCantConnect passed with no skips.
  Site build passed with the existing large-chunk warning; changed-page local links/anchors and
  git diff --check passed. No real database connection, daemon startup or native setup executed.

### DOC-004 — Complete: practical authoring and persistence boundaries

- Created docs/guides/database-editing.md with prerequisites, template versus spawn ownership,
  representative creature/object/quest/item/spell workflows, saved-only and all-variant SQL
  exchange, REPLACE/schema/default/filtering limits, immediate icon import and partial batches,
  independent saves, shared loot/sounds, quest deletion, routes/formations/pools and world-table
  destinations. Linked manual, onboarding, sidebar and canonical save/recovery guidance.
- Reused DA-02/05 and DB evidence rather than repeating investigations. Rechecked templateIo,
  MenuBar labels, ItemEditor/SpellEditor creation/save controls, ObjectEditor/LootTab,
  sqlscript.go:planScript/importScript/importSQL, icons.go:PlanIconImport/IconName,
  wow/icon.go:IconFromPNG and app_icons.go:ImportIcons/ExportIcons. No runtime equivalence claimed.
- Passed seven vmangos tests: TestParseInserts, TestPlanImport, TestItemsScriptRoundTrip,
  TestSpellScriptRoundTrip, TestDeleteQuestSQL, TestIconName and TestPlanIconImport; passed two
  wow tests: TestIconFromPNG and TestIconFromPNGRefuses. No skips; synthetic/temp data only.
  Site build passed (existing chunk warning), all 26 links/anchors across guide/manual/onboarding
  passed, and git diff --check passed. No live SQL, UI/game, queued timing, concurrent-writer or
  table-engine rollback test executed. Guide states those limits; subsystem coverage stays Partial.

### DOC-009 — Complete: bounded recipe reconciliation, not live certification

- Corrected F-010 in docs/tests/spawns.md: frontend/probes/item-editor.js enters level 300,
  inspects Save and uses Revert; it never presses Save. Separate refusal evidence is
  vmangos/templates_test.go:TestEditorSavesRefuseOutOfRangeValues and
  frontend/tests/templateEditor.test.ts refusal callback tests, not a rendered tab jump.
- F-014 failed-extraction restart and F-015 mmap.enabled/installation claims were corrected
  under DOC-005. Added evidence/remaining-recipe limits to docs/TESTS.md; clarified standalone
  browser-page versus backend-sharing probe versus pure-rule checks in the browser README,
  working directory and local disposable-only use of the disabled browser sandbox.
- Checked package.json probe entry, probes/run.mjs --shot <dir>/MELD_URL/nosave/sandbox paths;
  preserved screenshot-folder syntax. Matched terrain.html, paint.html and tile.html to README
  and pure tests; reused previously inspected testclient/guard/sandbox contracts, not reaudited.
- Passed TestEditorSavesRefuseOutOfRangeValues (one Go test) and 47 Bun tests across
  templateEditor.test.ts, chunkPaint.test.ts and tileImport.test.ts; no skips/failures. Site
  build and 21 local links/anchors across the testing index, seven recipe pages, troubleshooting
  and browser README passed. No probe/browser/GPU/client/database test was run. Other recipe
  bodies, historical notebook observations, all guard helpers and native platforms remain
  unverified; task completion is the explicitly bounded correction/link-selection scope.

### DOC-007 — Complete: internal extension orientation

- Extended docs/architecture/index.md with tool registration/dispatch, stroke undo, shared
  settings/Stamp, keymap/preferences, narrow Go App methods, generated bindings and one-shot
  binary handoff guidance. Links existing scripting/client references rather than a public SDK.
- Verified against Tool.ts, Engine tools map/pointer/key dispatch, TerrainTools BrushTool/Sculpt,
  historyCore push, editor ToolId/TOOL_SETTING_KEYS/keymap, ui tools/commands/runCommand, Toolbar,
  Makefile bindings targets, main.go App binding/handoff route, app_region.go handOffAlpha,
  io/region.ts alpha fetch and internal/handoff Put/Take/ServeHTTP/TTL. Synthetic contract only.
- Passed 101 Bun tests in history.test.ts, shortcuts.test.ts and toolUndo.test.ts and Go
  TestServeOnce; no failures/skips. Site build and architecture-index local links/anchors passed.
  No bindings generated, native app built, pointer/UI/GPU frames exercised or external writes made.

### DOC-008 — Complete: Lua examples, current support and error boundaries

- Corrected the manual's stale claim that texture layers/water/holes are unsupported: current
  prelude/EngineScriptHost implements those plus chunk area/impassable edits. Vertex colours
  remain no-ops with notice; general file/image writes absent. Added a safe read-only example,
  shipped hill-starter workflow, separate script/map saves, yards/editor axes/degrees, trusted
  scripts, libraries, world-view refusal and partial-error Undo precautions. DESIGN unchanged.
- Rechecked scriptApi openScript/ScriptSession library/time-limit/result/session paths,
  Engine.runScript returned-result finish/history, ScriptRun finish compound palette/terrain/
  chunk/liquid/model command, ScriptBrushes event queue/failure/release/retention/tags,
  ScriptBrushTool deactivation and ScriptWindow starter/storage controls; reused prelude and
  internal/scripts path evidence. Clarified that returned handler errors suppress callbacks;
  retained edits become history after end/queued completion, not immediate rollback.
- Passed 32 Bun tests in luaScript.test.ts/scriptGround.test.ts and three internal/scripts Go
  tests (temporary files), no skips. Executed the exact manual inspection snippet and shipped
  ScriptWindow STARTER through runScript using fakeHost extracted/transpiled from the existing
  test; inspection printed vec(1, 2, 3) plus zero models and no writes, starter raised heights
  with one block write. This ad hoc in-memory check created no fixture/source files.
- Site build and changed-page links/anchors passed. Native ScriptWindow/probes/brush pointer
  events were not run; count-hook timeout is not a hard awaited-host cancellation deadline.
  Unexpected host/import exceptions and shutdown/cancellation matrix remain DA-06 follow-ups,
  not a claim of comprehensive rollback or security sandboxing.

### DOC-011 — Source precautions implemented; native/distribution completion Blocked

- Added F-020 recursive installation-folder deletion and separate WebView2 data/shortcut/
  generated-association removal warning in build/README.md and docs/development.md. Keep
  author/client/server assets outside install directory; no uninstall command was executed.
- Rechecked project.nsi scope/default path/uninstall section and wails_tools.nsh execution
  level/files/WebView2/association macros. Reused DA-07 notices/sibling evidence and rechecked
  frontend/scripts/notices.mjs, benilla-launcher/Cargo.toml and .github/workflows/docs.yml.
  Documented docs-only Pages deployment, Windows versus Linux evidence, optional Rust/sibling
  launcher not implied by NSIS binary macro and npm/Go notices coverage, not a licence finding.
- Site build and local links passed. No application/native installer/runtime test appropriate
  to execute here. Exact remaining blockers: disposable Windows install/WebView2/association/
  uninstall host and Linux WebKitGTK runtime host; distributor artifact/revision/assets and
  Rust attribution decisions. DOC-011 is Blocked, not Done; no cross-platform/release certification.

### DOC-006 — Useful workflow slice implemented; task remains Todo

- Added manual steps for world-view browsing versus project-gated Edit Here, flying/walking
  limitations, local navigation preview versus stored server mmaps, two-click path testing,
  region compile/spawn growth guards, non-undoable new-world snapshot growth, height import
  arithmetic and asset-reference exchange limits. Linked terrain/tools references; no full
  rendering/generation/reference completeness claim.
- Targeted source: MenuBar exact labels, io/region openWorldView/editWorldHere/extendRegion,
  regionGrow grownBlock/growableSides, Engine startPathTest/navPathPoint/growWorld,
  CameraController navigation/collision contracts, heightmapImport arithmetic/resampling,
  and PathTool appliedOf/apply with per-Terrain application commands and history wrappers.
  Source clarified that reapply can undo a live cached application, but this cache is not
  serialized. Updated manual/tools scope accordingly; native repeated fence/UI/interleaved
  application behavior remains unexecuted. This narrows DA-04, not a new investigation ID.
- Passed 14 Bun tests across regionGrow/worldGrow/heightmapImport/navServer and 15 paths tests,
  no failures/skips. The initial command also named nonexistent pathApply.test.ts; Bun ignored
  that filter, so paths.test.ts was explicitly located and run separately. Only actual 29 tests
  are counted. These tests do not execute PathTool UI reapply or real server/GPU frames.
- Site build and changed-page links passed. Remaining DOC-006/DA-03/04: generator seed/scope
  and selection/mask/liquid interactions, complete image/model-list/brush/set exchange, Check
  Map/focus and rendering model/worker/LOD/animation/environment/shader resource boundaries.
  Needs Investigation for those source slices; native/game fidelity separately requires
  authorized app/assets/session. Do not repeat the completed growth/height/save/SQL/Lua checks.

### Session-6 verification summary and continuation

- Completed six stable tasks: DOC-005, DOC-012, DOC-004, DOC-009, DOC-007 and DOC-008.
  No P0/P1 remains open. DOC-006 useful slices are implemented but remaining source contracts
  Need Investigation; DOC-011 source precautions implemented but native/distribution closure
  Blocked; DOC-010 Deferred. All 12 DOC IDs and seven DA IDs/history retained.
- Actual current-session application checks: 21 Go top-level tests and 209 Bun tests passed,
  no failures/skips, plus two in-memory fake-host Lua example runs. See each task record above
  for suite names and counts. Session-5 executions are not added to these totals. No live writes.
- Documentation built after each completed task and each additional useful slice, with the
  same non-failing VitePress >500 kB chunk warning. Final local check covers 149 Markdown
  links/anchors across 37 documents, using rendered site IDs for site anchors. All passed.
  An early checker assumed extensionless LICENSE files ended in .md and counted shell comments
  as headings; correcting those checker assumptions removed false positives, not repo defects.
- Structural checks on all 20 changed/new management/Markdown files passed: one H1 outside
  code fences, balanced fences, no NUL/trailing whitespace. New authoring page renders and
  sidebar/manual/onboarding route exists. Browser hydration/search/visual/accessibility and
  external GitHub links were not exercised; site build is not proof of those behaviors.
- SHA-256 comparison with the session-start baseline for 1,146 tracked files found only
  16 Markdown documentation edits and docs/.vitepress/config.mts changed in this session.
  No application/generated/fixture file changed. HEAD unchanged; preexisting settings guide
  hash unchanged, and README/site-home/Benilla preexisting edits untouched by this session.
  Normal git diff also includes earlier work; do not attribute its full output to this session.
- At the context-bounded handoff, no task lease/background job remains. Resume DOC-006/DA-04
  generator/mask/liquid/exchange/Check Map slices, then DOC-006/DA-03 resource/rendering limits.
  Request native hosts/assets/session and distributor artifacts only for the exact DOC-011/
  DA-03/07 closure questions. Do not repeat completed save/DB/author/Lua/contributor corrections.

## Documentation completion and quality review — 2026-10-28, session 7

### Boundary and change discovery

- Read the roadmap, audit and rules before implementation; retained stable DOC/DA/F IDs and all
  earlier dated evidence. Baseline HEAD is `0d935acf50662d68c6b46f0381605b3e99c54b6c`; compared
  `git diff --name-status 98e7a4d69a3d3b65f313a2589afa21516aaec52a..HEAD` and working-tree status.
  Newer application paths include Engine/Terrain/tools/object/ground-effect layers, image/normal
  conversion and probes/tests. Current relevant callers were read rather than assuming the older
  source baseline remained unchanged. No unrelated implementation changes were made.
- Session-start tracked-file SHA-256 snapshot separates this session's changes from the many
  preexisting Markdown/navigation edits and untracked management/guide/operator files. Preserve
  those edits; full `git diff` is not this session's patch. No commits, branches or live operations.

### DOC-006 / DA-04 — Source-verifiable workflow acceptance complete

- **Creation/scope:** read `components/NewMapDialog.svelte` tile-square/mask/CoastShape/seed,
  image/water settings and create caller; `terrain/generate.ts:generateHeights/imageGroundHeights`
  and erosion order; `Terrain.generate/generateFromImage/setTileMask`; `Engine.newDocument`,
  `newVmangosDocument`, `layRivers` and `regenerateAutoPaint`. Confirmed creation fills a new square,
  seeded ground depends on dimensions/options, tile presence is distinct from an unsaved paint mask,
  image controls replace preset controls, lakes/rivers precede shore-aware creation paint and later
  auto-paint is whole-map texture replacement without those shore inputs.
- **Mask/liquids:** read `tools/maskWand.ts:wandClick/editWholeMask`, `terrain/maskSelect.ts`
  wand/combine rules, `state/areaSelection.ts:areaShape/areaCells`, `TerrainTools.ts:WaterTool`,
  `Engine.selectionCells/shapeChunks/cropWater/regenWaterOpacity/importWatermap`,
  `water/liquids.ts:cropLiquids/regenOpacity` and liquid stroke snapshots. Important documented
  boundary: selected rectangles/free-form areas filter touched liquid **chunks**, not exact cells
  for crop/opacity; paint masks do not constrain water. Watermap black is leave-alone, not erase.
- **Exchange:** read `io/images.ts` export/import dispatch, `io/watermapImport.ts:watermapCells`,
  `io/heightmapImport.ts:imageRatios`, `Engine.importAlphamap/alphamapOf`, `io/lists.ts` whole-map
  export/additive import and preference appends, `world/objectList.ts:formatObjectList/parseObjectList`;
  inspected existing brush/set parser tests and `AssetBrowser.svelte` set Import/Export/Delete
  controls. Read `internal/heightmap/heightmap.go:Encode/EncodeRGB/Decode`, grey image helper/tests
  and `app_dialogs.go:ReadHeightmap` binding dispatch. Documented grey PNG dimensions/clamping,
  ranges/units, whole-map versus tile scope, partial errors, four-slot refusal, root-only lists,
  preference imports without map Undo and client asset references rather than bundled assets.
- **Check Map:** read `CheckMapWindow.svelte` run/effect/fix/fixAll controls, `Engine.checkMap`,
  `focusFinding`, `fixFinding`, `check/run.ts:runMapChecks`, terrain diagnostics and
  `findings.ts:capped`. Documented camera versus selection, per-fix Undo, chunk-wide crop,
  stale/dimmed result lists, unloaded models and unavailable client/border/DB checks. The DB query
  can follow the documented startup path; no query was executed. A clean list is not certification.
- Updated existing manual/getting-started and terrain/tools/water/UI reference sections; no new
  guide/API dump. Session-6 growth/height/nav/path material retained. F-017's task-level gap is
  resolved for source-verified instructions. Native dialogs, Check Map focus/fix interactions,
  repeated/interleaved path Apply and game-format fidelity remain unexecuted, not implied passing.

### DOC-006 / DA-03 — Rendering boundaries reconciled, not native parity

- Read `models/modelBuild.ts` pool startup/fail/buildHere/buildModel/adoptModel and
  `modelWorker.ts` job responses; `assets.ts:getAsset/loadAsset/retryDue/releaseWowAsset/releaseAssets/evict`
  and pending/building/loose sharing; `Engine.releaseModels` keep sets; `models/lod.ts:lodIndex`
  and `world/Animator.ts:ModelAnimation` shared idle pose; ObjectLayer near/far/picking call sites.
  Documented global worker-pool failure versus an individual rejected job, main-thread fallback,
  drop-on-arrival, shared-resource ownership and LOD targets, not guaranteed mesh/GPU savings.
- Read `Engine.applyClientLight/updateWeather/markShadows`, Environment shadow hold/fit policy,
  `world/WorldStream.ts` load/generation/drop/dispose and stride/liquid call sites, and liquid shader
  lighting branches. Reconciled current reference descriptions of streaming terrain/horizon,
  small-model reach, chunk liquids, shadow refresh delay, fallback lighting, shared idle animation,
  temporary weather and separate Show/Graphics/Lighting controls. Detailed historical shader/effect
  and room/culling notes were not all re-audited; references remain Partial overall.
- F-016 author orientation is resolved. Added bounded technical contracts to objects/lighting and
  linked existing rendering recipes. Pure tests do not execute real module workers/WebView, GPU
  disposal, shader compilation or actual WMO/liquid/shadow frames. DA-03 native fidelity stays
  Blocked on an authorized app/assets/session and coordinated compiled-game comparison.
- DOC-006 is **Done** because every bounded documentation acceptance item (trace, invariants,
  remaining limits, synchronized coverage, build/links) passes. DA-03/04 source questions close for
  this scope, not every child/subsystem; all 14 parent audit labels remain Broadly Audited.

### DOC-011 and DOC-010 — External boundaries preserved

- Re-read `build/windows/installer/project.nsi` install/scope/uninstall and corresponding macro
  references; retained recursive install-directory deletion, WebView2 data/shortcut/association
  warnings in build/development docs. Existing npm/Go versus sibling Rust/Benilla boundary retained.
- Development guide now has a concrete disposable-host matrix: generated package scope/payload and
  first launch; WebView2 existing/missing/network failure; actual generated file/protocol handlers;
  synthetic-sentinel uninstall/data cleanup and prior-handler treatment; native Linux dependency,
  build and window startup checks. Record artifact hash, revisions and OS/architecture per result.
- Distributor decisions remain: supported artifact/architecture, install scope, release/signing/
  update policy, optional launcher inclusion, exact sibling revision/assets and Rust/sibling asset
  attribution. No distributor policy, legal clearance or runtime result was invented. DOC-011 is
  **Blocked**, not Done. No installer build/install/uninstall or Linux native test was attempted.
- DOC-010 remains **Deferred**; `docs/DESIGN.md` was not edited. Explicit owner approval is still
  required; historical/draft navigation and current scripting instructions remain available.

### Whole-documentation quality findings

Reviewed the reader routes through README, site home/sidebar, getting-started, manual, save/compile,
database/settings guides, troubleshooting, development/testing and architecture/reference indexes.
This is a source/structure/content review, not an observed novice usability study or browser QA.

| Reader question | Assessment and meaningful disposition |
| --- | --- |
| What is Meld? | README/home/onboarding agree on 1.12.1, Windows/Linux, own client assets and VMaNGOS; no expansion into unsupported clients/platforms needed. |
| Can I install/configure it? | Onboarding links build prerequisites and separates client/project from DB/game login. Source instructions are usable; native first-launch/package setup remains DOC-011 evidence, not proven by prose. No unverified release download was added. |
| Can I make a first edit? | The numbered client → starting point → navigation → sculpt/paint/place → saved copy route is intact. Added the generator scope link without front-loading advanced algorithms. |
| Save versus Compile/Publish? | Canonical save guide already explains working files, external writes and recovery; manual keeps prominent warning/links. Exchange now distinguishes standalone exports, preference changes and client minimap writes. No duplicated save tutorial. |
| Can I troubleshoot? | Existing symptom-based diagnostics cover paths, DB, locks, pending writes and logs. Added a direct Check Map workflow/limitations link rather than another diagnostics page. Native remedies remain unexecuted. |
| Can a contributor build/debug/test? | Build/test references already separate synthetic/live checks. Added a focused debug route to logs/scenes/performance, feature recipes and backend-sharing precautions, not guessed debugger hotkeys. |
| Navigation and concept order? | Sidebar separates Using Meld, Contributing, Architecture, Regression and historical notebooks. Existing pages remain reachable. Added manual jump links; scopes and preview limits are explained before linking internals. |
| Length/repetition/scannability? | Dense architecture pages remain specialist references, not mandatory onboarding. Added short contract introductions and links to practical steps; kept one exchange table and one checklist, not per-format pages or duplicated implementation dumps. No wholesale split/rewrite justified by this review. |
| Sustainable maintenance? | All currently actionable tasks complete. Existing DOC/DA IDs hold native and owner dependencies. Recheck on source changes, concrete reports or release preparation; no new low-value tasks, timers or blanket re-audits. |

### Session-7 validation

- **Passed:** `bun test tests/terrainGenerate.test.ts tests/tileMask.test.ts tests/maskSelect.test.ts
  tests/watermapImport.test.ts tests/liquids.test.ts tests/objectList.test.ts tests/doodadBrush.test.ts
  tests/modelSets.test.ts tests/mapCheck.test.ts tests/lod.test.ts tests/clientLight.test.ts
  tests/weather.test.ts tests/weatherRoof.test.ts tests/normalMap.test.ts tests/heightmapImport.test.ts`
  from frontend/: **91 tests across 15 files, zero failures/skips**. Counts are this run only.
- **Passed:** `go test ./internal/heightmap -count=1 -v`: **eight top-level tests**, no failures/skips;
  synthetic PNG/grey/size/round-trip/clamping cases with temporary files, not a real client write.
- **Passed:** `cd frontend; bun run docs:build`, VitePress 1.6.4; only the existing non-failing
  >500 kB bundle warning. Local Markdown links/anchors checked against actual built site IDs;
  final structural/rendered-navigation/preservation results are recorded at closure below.
- **Not run:** application build/format/full live suite (documentation-only scope), native Wails,
  game/server/database/extractor, installers, real workers/GPU, browser hydration/search/theme/
  accessibility and external-link availability. A static build does not prove those behaviors.
- Tooling corrections: Windows apply_patch batch wrapper did not preserve multiline arguments;
  invoked its underlying apply_patch entry point directly. One relative-path patch ran from
  frontend/ and failed without changing a file, then was applied from the repository root.
  Early guessed source globs/missing filenames were resolved before evidence was credited.

### Maintenance closure

Final checks: **180 relative Markdown links/anchors across 37 documents** and **1,677 rendered
internal links across 31 published pages** passed, including sidebar routes and built heading IDs.
The final site build passed after the last published-page edit (same non-failing chunk warning).
`git diff --check` passed. Session-start SHA-256 comparison of **1,149 tracked files** found exactly
**ten changed tracked Markdown pages**: manual, getting-started, development, troubleshooting and
the six terrain/tools/water/objects/lighting/UI references. No tracked application/config/generated/
fixture file changed in this session; the three already-untracked management files were updated
separately. Preexisting navigation and other tracked documentation edits remain untouched by this
session. All **13 session-edited Markdown files** passed one-H1, balanced-fence, NUL and trailing
whitespace checks. Link and build results do not certify browser hydration/search/theme/accessibility.

DOC-001–009 and DOC-012 are Done; DOC-011 Blocked, DOC-010 Deferred. No Ready task, P0/P1,
task lease or background work remains. Request native/distributor resources only for the concrete
matrix, and owner approval only for DESIGN. Keep remaining DA-06/runtime questions as event-driven
investigation limits, not an invitation to produce an endless backlog.

## Final documentation-first acceptance review — 2026-10-28, session 8

### Method and evidence boundary

Read the management files and published reader paths before inspecting application source:
README, site home, getting-started, manual, save/compile, database authoring, settings/backups,
troubleshooting, development, testing and optional Benilla/build/browser-check instructions.
Reviewed these as written workflows, not an actual novice session. Then verified suspected setup
gaps against the unchanged HEAD `0d935acf50662d68c6b46f0381605b3e99c54b6c` and working tree.
This was a bounded acceptance review, not another subsystem-wide implementation audit.

| Workflow evaluated | Documentation-first assessment and disposition |
| --- | --- |
| Purpose and capabilities | Home/README identify audience, supported client, editing features and platform limits. Sufficient; no rewrite. |
| Prerequisites and application setup | Source-build route was linked, but acquisition/root was assumed and README overstated WebView2 availability. F-021 corrected below. No binary download or release policy invented. |
| Configuration | Client/project setup and database readiness explain paths, SQL versus Game Login and private settings. Sufficient; a project is not an asset/database backup. |
| Basic world editing | New-world and existing-region paths lead through camera/tools, small edits, Undo and Save As. Sufficient for source-backed instruction review; native dialog usability remains untested. |
| Saving, compiling and publishing | Existing operation/write/recovery distinctions are strong. Exact server extractor prerequisites were missing and configuration wording misleading; F-022 corrected below. |
| Database editing safety | Shared templates versus spawns, immediate creation/import writes, independent saves and partial failures are warned about before actions. Preserve existing guide; live schemas and engine rollback remain unverified. |
| Common problems | Symptom-based routes cover assets, database connection, pending writes, partial results, stale caches, recovery and reporting. Sufficient; no source lookup required for those remedies. |
| Development environment | Prerequisites, dependencies and platform-specific commands exist. Added source acquisition and explicit repository-root transition rather than a new onboarding page. |
| Build, debug and test | Desktop commands, focused-test selection, diagnostics and safe probe/integration boundaries are linked. Source/config checked; native build/debug and full test-suite execution are not claimed. |
| Navigation and terminology | Entry links and sidebar separate authors, contributors and historical notes. Save/compile/publish remain distinct. New setup anchor is reachable from README; no restructure needed. |

### F-021 — Source acquisition and prerequisite navigation assumed a prepared checkout

- **Classification:** high-impact usability improvement for acquisition/root; verified documentation
  defect in README's unconditional WebView2 availability claim. Resolved in this session.
- **Evidence:** repository origin identifies the clone URL; `go.mod`, `Makefile`, `wails.json`,
  `frontend/package.json` and `.github/workflows/docs.yml` establish root commands, frontend install
  and build sequence. Existing development instructions already require WebView2 when missing;
  `build/windows/installer/project.nsi` invokes `wails.webview2runtime`, not an assumption of presence.
- **Correction:** Git prerequisite, explicit clone/cd and root definition in development; README
  routes to source/dependency setup before commands and says to install WebView2 if missing.
- **Limit:** tools/OS dependencies were not installed and a fresh checkout/native build was not run.
  `bun --version` was 1.4.3 and `go version` was go1.26.4 windows/amd64 on this existing host.

### F-022 — Server extraction prerequisites were not actionable before external writes

- **Classification:** verified missing essential prerequisite and inaccurate configuration wording;
  resolved in the canonical save/compile guide, without a new page or task.
- **Evidence depth:** read `internal/vmangos/install.go:CheckServer`, `publish.go:Publish`,
  `publishServer`, `UpdateServerMaps`, `extractServerMaps`, `buildMoveMaps` and the platform guard.
  Inspected `publish_test.go:TestPublishServerRunsStepsInOrder`; other extraction/movement-map
  test names were located, not credited as executed or fully inspected. CheckServer validates
  config/data only; extraction invokes three fixed run/Extractors executable paths after earlier
  client/SQL writes. A missing MoveMapGenerator logs and leaves navigation data unchanged.
- **Correction:** root/config/data layout, database-readiness link, required extractor filenames,
  optional generator and limited folder validation now precede compile/publish. Publishing no
  longer implies that mangosd.conf specifies the extractor paths.
- **Limit:** external tools, compatible VMaNGOS distribution and live outputs were not exercised.

### Acceptance, validation and remaining limits

- **Passed:** `cd frontend; bun run docs:build`, VitePress 1.6.4. Only the existing non-failing
  bundle-size warning remained. No application/server was started.
- **Passed:** final one-off Bun validation using VitePress's bundled Markdown parser checked **705
  relative links across 37 Markdown documents** and **1,681 rendered internal links across 32 HTML
  files (including 404)** against local files/routes and actual generated IDs, with zero failures.
  This includes sidebar links, not browser hydration, interactive search or external URL availability.
- **Passed:** `git diff --check`; all five session-edited Markdown files have one parsed H1,
  balanced code fences, no NULs and no trailing whitespace. SHA-256 comparison of 1,149 tracked
  files plus the three management files found only README, development, save/compile, roadmap
  and audit changed during this session. Preexisting source/config/navigation work was preserved.
- **Unverified runtime assumptions:** first-run native Windows/Linux dependency installation,
  installer/WebView2 behavior, actual editing/database/game workflows, debugger operation, workers/GPU
  and server extraction remain unexecuted. Source checks and a site build do not certify them.
- **Optional enhancements:** screenshots, IDE-specific debugger recipes and release download links
  need a concrete reader/runtime/distribution requirement; none is necessary to extend this review.
  No new backlog tasks, real-user study, live tests or unsupported platform promises were created.
- **Acceptance:** passes this **source-backed documentation acceptance review** after F-021/022.
  Essential paths are ordered and discoverable, warnings precede external writes, and contributor
  commands are checked where available. DOC statuses are unchanged: DOC-011 remains Blocked and
  DOC-010 Deferred; native/distributor and owner dependencies are not silently closed.

## Publication, CI and live-site verification 2026-10-28 session 9

### Change boundary and publication status

- Local source baseline: `0d935acf50662d68c6b46f0381605b3e99c54b6c`, branch `main`.
  Initially the index was empty. Reviewed working-tree status/diffs and attributed the modified
  guides, navigation, README/build/browser-test documentation, CLAUDE maintenance section and
  three management files to the documentation project. `.agents/issue-loop.md` is unrelated
  preexisting operator work and is excluded, unchanged. Generated VitePress output/cache remain
  ignored. No application source, lockfile, credentials, branches or existing commits were changed.
- Preserved the Bun/VitePress 1.6.4 architecture, `base: '/Meld/'`, clean URLs, local search and
  `docs/.vitepress/dist` upload. Changes belong in the dedicated local commit
  `docs: complete documentation overhaul and maintenance system`; its final SHA is reported in
  the session handoff rather than embedded self-referentially in that commit.
- GitHub authentication and Pages settings were readable. Pages uses Actions, HTTPS and
  `https://coldensjo.github.io/Meld/`. Latest observed existing Docs run **40711078951** completed
  **success** for remote head `cdbb814d4467eb14ebe3ae989e2f7f65fdf0aa8e`. This is historical
  deployment evidence only, not a run of the local documentation/CI changes.
- `git rev-list --left-right --count origin/main...HEAD` before the dedicated commit was `20 0`;
  the GitHub main-commit API confirmed the same remote head. Remote changes overlap README,
  CLAUDE, development/testing/scripting docs and add `.github/workflows/check.yml`. Inspected
  that remote workflow and confirmed the Pages workflow/config/package base are unchanged.
  Did not merge these changes or re-audit their application contracts in this documentation task.
- **Publication blocked:** no explicit authorization to push. Even after authorization, reconcile
  remote main's newer work using a history-preserving integration, resolve overlaps without
  losing either side, and rerun affected documentation checks before a normal push. Do not
  force-push, reset, or dispatch an old remote commit as a substitute. The two new guide routes
  and `revision.txt` return 404 on the current deployment; that confirms they are not published.

### CI coverage and local verification

- Extended the existing Docs workflow rather than adding a parallel documentation pipeline.
  Relevant Markdown, site, package/lockfile, checker and workflow changes validate on PRs and
  main pushes; manual dispatch remains. PRs cannot configure/upload/deploy Pages. The deploy
  job alone receives Pages-write/OIDC permissions, and only main can run it. Build uses read-only
  permissions, frozen dependencies, pinned Bun 1.4.3 and cached Bun downloads. No production
  secret is needed. Main's existing Pages environment/artifact deployment is preserved.
- `cd frontend; bun run docs:check` builds the site, then uses VitePress's existing parser and
  Bun's HTMLRewriter to check relative Markdown links/images, case-sensitive missing files,
  generated routes/anchors, navigation references and HTML asset references. Structure checks
  require one H1 per prose/rendered content page (not the theme's 404), closed fences and no NULs; the home layout's
  title is checked after rendering. This is not comprehensive style linting or external-link QA.
- **Passed:** `bun install --frozen-lockfile` (no dependency changes); VitePress production build;
  **38 Markdown documents, 730 relative links/images, 32 HTML pages and 2,010 rendered
  references**, including the new management evidence and its internal links.
  The existing non-failing large-bundle warning remains.
- **Passed:** seven Bun checker regression tests, including missing/wrong-case targets,
  subpath escapes, missing rendered anchors, malformed Markdown and an isolated deliberately
  broken VitePress build that exits nonzero with a dead-link diagnostic. Synthetic failure
  fixtures live in disposable temp directories, not maintained documentation or application data.
- **Passed:** actionlint 1.7.7 on `.github/workflows/docs.yml` (shellcheck/pyflakes disabled;
  neither is required for the simple Bun/Git commands), targeted existing Prettier formatting
  and `git diff --check`. No new checker dependency or application test suite was introduced.
- **Not run:** GitHub Actions for this commit, Linux execution of the new checker, a new Pages
  deployment, or post-deployment acceptance. Future uploads include `revision.txt` with the exact
  workflow head SHA; compare it with the intended commit after authorized integration/publication.

### Existing-live-site browser checks, not acceptance of the unpublished changes

- Used the shared interactive browser against the actual GitHub Pages URL, with real clicks,
  typing, keypresses, direct navigation and reload; inspected a mobile development-page PNG.
  One initial snapshot timed out, then browser automation worked. This is automated browser
  interaction plus limited screenshot inspection, not a real-user study or exhaustive visual QA.
- Homepage and primary navigation worked. Clicked Get started, sidebar Development and mobile
  Get started; navigated between author and contributor documentation. Browser-side read-only
  requests loaded **28 unique existing navigation pages**, all HTTP 200. Parsed their HTML and
  checked **360 links with fragments** against target IDs, with no missing anchors in that set.
  This is not a crawl of every external link or proof about the unpublished new guides.
- Direct `/Meld/development#work-on-the-documentation` loaded with its anchor visible. A real
  `location.reload()` produced navigation type `reload`, retained the route/anchor and hydrated.
- Measured actual browser viewports: **1920x1080** (home/getting started), **1366x768** (getting
  started/search), **768x1024** (troubleshooting/sidebar) and **390x844** (development/home/mobile
  navigation/search). No document-level horizontal overflow in these samples. Development's
  long mobile code lines stay in horizontally scrollable `pre` containers; the inspected PNG
  showed readable wrapped prose and a separate code scrollbar, not page clipping. No claim of
  all pages at all sizes, every overlap, every zoom level, or every code line's visual inspection.
- Local search initialized and returned results for **installation**, **database editing**,
  **compiling** and **troubleshooting**. Queries returned 16, 16, 16 and 15 result links respectively
  in the existing site. Compiling's first result targets the save/compile guide; troubleshooting's
  first result targets its page. ArrowDown changed the active descendant; ArrowUp/Enter opened
  the expected troubleshooting fragment. A nonsense query returned a visible No results message
  and zero links; Escape closed search. Mobile search also returned results without page overflow.
  The new database guide cannot appear until publication; older results are not its acceptance.
- Tablet Menu toggled the sidebar and `aria-expanded`, and choosing Development closed it.
  Mobile navigation exposed labelled controls with `aria-controls` and `aria-expanded`, fit the
  viewport, and Tab reached Get started with `:focus-visible` and a nonzero outline; Enter opened
  that page. Search input has a labelled-by label and autocomplete/active-descendant attributes.
  Guide pages expose main/sidebar/navigation landmarks and a single content H1. The inspected
  pages had no missing/broken images; images/alt text were not exercised on image-heavy content.
- Observed Vue hydration and successful CSS, JavaScript, local-search index and font responses.
  Returned browser diagnostics showed no application console errors; there were repeated
  unused font-preload **warnings**. Navigation/resource requests examined were successful except
  the three deliberate 404 publication probes (new guides and absent revision marker). No claim
  of continuous network capture, all external resources or every interaction's runtime behavior.

### F-023 — Live default-theme accessibility findings

- **Evidence:** axe-core **4.10.3**, loaded only in the QA browser (not added to the project),
  ran WCAG 2 A/AA and 2.1 A/AA checks on troubleshooting at laptop width; additionally ran
  best-practice checks on the mobile homepage and WCAG checks with mobile search open.
- **Troubleshooting:** 24 automated rules passed, no incomplete rules; serious color contrast
  for `.lang` (code language label, **2.87:1**, expected 4.5:1), plus nested interactive controls
  in the three collapsible sidebar group headers. Actual keyboard/menu interaction still worked;
  that does not establish correct screen-reader announcements.
- **Homepage:** 30 rules passed, no incomplete rules; brand button contrast **4.48:1** versus
  4.5:1, missing main landmark (`landmark-one-main`) and content outside landmarks (`region`).
- **Mobile search open:** 33 rules passed; nested interactive search overlay and result rows,
  plus the underlying homepage brand contrast finding. Search color contrast had an **incomplete**
  result requiring manual investigation, not a pass. Search selection worked by keyboard but
  its assistive-technology behavior is not certified.
- **Action:** DOC-013 P2 Ready/Todo tracks a focused theme fix and deployed retest. No upstream
  patch, full theme-source review, exhaustive contrast audit, dark-theme pass, screen-reader
  testing or complete WCAG certification is claimed. These verified issues do not reopen the
  completed source-backed application guides, DOC-011 native checks or DOC-010 owner decision.

## Documentation accessibility and usability (2026-10-28, session 10)

### Scope and implementation review

- **Baseline:** starting HEAD `a9643c7ec05345d273708c7d34c5e5663b5d7eea`; live
  `/Meld/revision.txt` returned HTTP 200 and this same SHA on 2026-10-28. The session-9 report of
  unpublished guide URLs is historical. This session did not commit, push or deploy its new edits.
  The preexisting untracked `.agents/` directory was left alone; no application source changed.
- **Fully inspected for this bounded task:** `docs/.vitepress/config.mts`, the pinned VitePress
  **1.6.4** default-theme `VPHome.vue`, `VPSidebarItem.vue`, `VPLocalSearchBox.vue`, `VPSidebar.vue`,
  `VPNavScreen.vue`, `VPSwitchAppearance.vue`, search-button/parent navigation wiring, sidebar/nav
  and data composables, base/variable CSS, VueUse's `useFocusTrap` lifecycle, and emitted code styles.
  Reviewed local search indexing, result anchors, arrow/Enter handlers, close events, focus trapping,
  query/detail persistence and router integration. No framework replacement or dependency upgrade.
- **Correction boundary:** `theme-patches.mjs` transforms only the named upstream components before
  Vue compilation; exact-match guards fail on changed source instead of silently dropping fixes.
  `theme/index.ts` extends the existing theme and imports narrowly scoped CSS. `codeContrast.tokens`
  adjusts only failing syntax colors. No installed dependency files were edited or vendored.
  Existing structure, pages, search provider, result click handlers and routing are retained.

### F-023 — Verified findings and corrections

| Verified issue and root cause | Small correction and evidence |
| --- | --- |
| Code-language labels used muted text, **2.87:1** on light code backgrounds; default brand button was **4.48:1**. Syntax red/orange and code comments also failed normal-text contrast; comments were **4.45:1** in light mode and **3.75:1** in dark mode. | Override language/line-number text and brand-button state colors; adjust the failing Shiki token colors only. Source-palette checks give the normal brand button **4.79:1**, corrected light syntax samples **4.71–5.01:1**, and dark comments **5.88:1**. Both-theme page audits pass contrast checks on measurable text. |
| Unselected detailed-search excerpts applied group opacity **0.5**, making ordinary text approximately **2.67:1** on white. This visible text was not covered by axe because the excerpt is inert. | Restore full excerpt opacity with specificity that survives lazy-loaded scoped CSS; preserve layout, clipping and the existing inert excerpt. Browser regression checks assert full opacity and independently measure excerpt/search colors. |
| Homepage wrapper was a generic div, with no main landmark. | Add `role="main"` to that wrapper without moving content. This corrects an axe landmark/best-practice finding; the missing landmark alone was not treated as proof of a WCAG failure. |
| Sidebar headers nested two button roles, had no expanded state, did not handle Space, and exposed dead focus stops on noncollapsible headings. | Keep one named toggle per unlinked collapsible group; make its caret decorative. Restrict role/tabindex to working controls, expose expanded state, handle Enter/Space without page scrolling, and provide a visible focus outline. Linked-parent caret support is retained. |
| Search overlay used a button role around form controls; listbox options wrapped focusable links; shortcut `kbd` elements used prohibited labels. | Use a named modal dialog, combobox input with list autocomplete and accurate expanded state, and one option-role anchor per presentation list item. Keep real hrefs and existing mouse/router/arrow handlers. Give labelled keyboard glyphs an image role. |
| Closing search with Escape returned focus to BODY on the live site at desktop and mobile widths. Focus-trap activation had captured the already-focused search field, not its opener. | Capture the active opener at component setup through the focus trap's return-focus option. Escape restores the Search button; Ctrl+K opened from a navigation link restores that original link. |
| A saved dark theme reloaded with a visibly dark page and “Switch to light theme” title but `aria-checked="false"`: prerendered switch attributes did not update during hydration. | Gate the checked state on a mounted ref, creating an explicit post-hydration reactive update. Tests check switch-state agreement after navigation/reload in both themes. |
| Off-canvas sidebar tried to focus a nonfocusable aside, leaving keyboard focus behind its overlay. Mobile main navigation allowed Tab behind its overlay and did not close with Escape. | Reuse the already-installed focus-trap integration: contain focus in the narrow sidebar, disable that trap at desktop width, and contain mobile header/menu focus while retaining its close trigger. Escape closes/restores focus; mouse selection still closes/navigates. No overlay redesign. |

These are reproducible runtime/source failures, not speculative cosmetic improvements. Content
heading order, accessible search/control names, skip navigation and reduced-motion CSS did not
require redesign. No content heading-level skips or duplicate content H1/main landmarks were found
in the navigable-page checks. There were **zero image elements** in those pages, so no missing-alt
failure was found; useful image descriptions were not meaningfully exercised.

### Search verification and environment distinction

- **Existing live site, before corrections:** direct browser clicks at widths **1366** and **390**
  opened `/Meld/guides/saving-and-compiling#saving-compiling-and-playing` for compiling, matching
  the clicked href. ArrowDown then Enter selected and opened the expected troubleshooting result
  in the engineering notebook. Escape closed search but left focus on BODY in both viewports.
  Thus the previously unverified mouse-result failure was **not reproduced**, while focus loss was.
- **Local corrected build:** desktop/mobile mouse selection and ArrowDown/ArrowUp/Enter open the
  exact selected route and existing fragment. Escape and the mobile close button restore focus;
  the latter does not accidentally submit/navigate. Tab stays within search, empty results remain
  open on Enter, and the input's controls/active-descendant IDs resolve to the actual list/option.
  A live no-results query followed by ArrowDown exposed a nonexistent `localsearch-item-0` reference;
  the local binding now requires an actual result before exposing an active descendant. Regression
  checks press both arrows with no results and confirm the reference stays absent.
- **Tool failures were not website fixes:** shared preview rejected selectors and a stale reference.
  After those control failures, testing switched to isolated Playwright/Chrome, which independently
  confirmed that live result clicks work. An early artificial iframe dark-mode audit caught
  transitional colors and was discarded, not used to redesign the theme. Direct theme interaction
  and settled/reloaded browser state supplied the accepted evidence.
- **Preview-server limitation:** rebuilding under a running VitePress preview produced 404s for new
  hashed assets because the preview cached its asset directory. Restarting that local server fixed
  the harness; no search/navigation or asset-path workaround was added to the site. The developer
  recipe now explicitly requires restarting preview after a rebuild.

### Validation and repeatability

- **Passed:** `cd frontend; bun run docs:check`: VitePress build, **38 Markdown files**, **740 relative
  links/images**, **32 HTML pages**, **2,013 rendered references**, navigation/anchors/assets and
  Markdown structure; **15 tests / 51 assertions** across the existing checker and eight new theme
  regression tests. Existing large-chunk build warning remains; no application/game tests were needed.
- **Passed:** optional `node scripts/docs-browser-check.mjs` using **Chrome 156.0.8078.47**,
  **Playwright Core 1.56.1**, **axe-core 4.10.3**, installed only in a temporary QA tools directory.
  Axe ran WCAG 2 A/AA, 2.1 A/AA, 2.2 AA and best-practice tags: **86 page/state audits, zero reported
  violations**. All **31 navigable pages** were checked in **both themes** at **1366x768**. The 404
  template and external websites are not included in that navigable-page accessibility claim.
- **Passed:** **18 keyboard/mouse interaction cases**, including skip-link/content focus, sidebar
  Space/Enter/state/ring, desktop/mobile search, focus trapping/restoration, empty results, mobile
  nav/sidebar opening/selection/Escape, and reduced-motion emulation. Mobile containment checks Tab
  repeatedly through the menu/sidebar, not merely a successful mouse click.
- **Responsive:** home, development, database authoring and troubleshooting checked at widths
  **1920, 768, 390 and 320**, with 1080px height at 1920 and 844px otherwise; no document-level
  horizontal overflow. Long code remains locally scrollable. Additional mobile menu/search audits
  use **390x844**. QA screenshots were visually reviewed, not used as exhaustive visual baselines.
  A separate browser check confirmed that resizing an open mobile sidebar to desktop releases its
  focus trap and body-scroll lock.
- **Incomplete results retained:** **54/86** audit states retain axe incomplete findings, chiefly
  clipped/overlapped code/result text; four search states additionally require popup-reference review.
  The actual referenced IDs were checked independently. **236 computed-color text samples** across
  ordinary/detailed desktop search in light/dark and mobile search were all at least **4.84:1**.
  These spot checks do not turn every clipped-code/gradient incomplete into a certified pass.
- **Diagnostics:** no application JavaScript exceptions, failed documentation assets or substantive
  console/network errors in the accepted run. Chrome's optional, unconfigured `/favicon.ico` request
  returned 404 and is explicitly retained as a nonblocking observation, not silently filtered away.
- **Evidence:** repeatable runner and guarded tests in `frontend/scripts/`; recipe at
  `docs/development.md#check-documentation-accessibility`. Machine-local JSON/screenshots are in
  `C:\Users\Chris\AppData\Local\Temp\meld-doc013-browser\` (`report.json`, `live-baseline.json`,
  desktop/mobile PNGs). They are QA artifacts, not committed site assets. Targeted theme/script/config
  Prettier checks and `git diff --check` passed. The workflow's Prettier warning also reproduces on
  unchanged HEAD; its existing layout was preserved for the two path-filter edits. CI path filters
  include both documentation checker and browser scripts.

### Remaining limits and DOC-013 acceptance

- **DOC-013 remains In progress, awaiting the deployed-revision retest** (publication authorized 2026-10-29). Its corrections are locally
  implemented/verified, but the original acceptance criterion requires retesting the corrected
  deployed revision. After the deployment, compare live `revision.txt` with that commit and
  rerun browser checks. Do not deploy or mark Done merely because local automation passes.
- **Not certified:** full WCAG 2.2 AA conformance, NVDA/JAWS/VoiceOver announcements, real touch-device
  interaction/virtual keyboards, every zoom/forced-colors configuration, or all clipped syntax and
  excerpt-gradient combinations. Viewport emulation is not a physical-device test. Remaining axe
  incompletes and assistive-technology behavior need manual assessment.
- Completed DOC-001–009/012 stay closed. DOC-010 remains owner-deferred and DOC-011 native/distributor
  checks remain blocked on their original resources. No new broad application audit or unrelated
  documentation task was opened. The edits were committed afterwards, on 2026-10-29, at the owner's request.
