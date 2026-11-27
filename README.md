# Flap Happy

Flap Happy has a visible main control window for MSFS 2024 gliders and an optional external flight ribbon, with the same ribbon in the sim (including VR). The ribbon shows indicated airspeed (IAS), flap speed ranges and actual flap position. Keep the main app running to use either panel. Profiles with both loaded reference weights use live flying weight; local manual ballast remains available.

The app is Electron with `node-simconnect`. It owns the sim connection and serves the cockpit panel. The display is plain HTML/JS/CSS in a conservative subset so the sim's browser can run it.

Spec: `docs/flap-display-proposal.md` (rev 12). Mockup: `media/ui-mockup.png`. Screenshots of this build: `media/flaphappy-*.png`.

## Run it (no programming needed)

You need either the portable exe or a folder with these files plus Node.js.

**Option A: portable exe.** Someone builds `FlapHappy-1.0.0-portable.exe` once (see "Build the exe" below). Put it anywhere and double-click it. Nothing is installed. Windows SmartScreen may warn "Windows protected your PC" because the exe is not code-signed: click **More info** then **Run anyway**.

**Option B: from this folder.**
1. Install Node.js LTS from https://nodejs.org (accept the defaults).
2. Double-click **`Start Flap Happy.bat`**. The first run downloads the components (a few minutes), then the window opens.
3. No simulator handy? Double-click **`Start Flap Happy (demo, no sim).bat`**. It runs on fake data with a control panel so you can try everything.

With MSFS 2024: start the sim first or after, either works. Flap Happy reconnects by itself. The main window shows connection status; the optional ribbon fills in once the sim is sending data. SimConnect needs no configuration or extra files; it connects over the sim's local connection.

### Main window and optional external panel

Start Flap Happy normally. The main control window always opens with its normal window
controls and can be minimized or closed to exit. It contains **Settings** and **Edit profiles**,
a **Show external panel / Close external panel** button, and a separate **Open the external
panel on launch** checkbox (off by default). This checkbox is saved across restarts;
manually opening or closing the ribbon does not change it.

The external ribbon and in-sim panel use the same locally served display. The main process
owns the telemetry and saved profiles, so closing the external panel or minimizing the main
window does not stop the feed. External always-on-top, opacity and zoom remain available in
Settings. Closing the main window exits the app and closes the external panel too.
A second launch (or `--show`) restores the existing main window; `--quit` exits the session.
The previous experimental windowless launch flag is no longer a windowless mode.

### Auto-hide in external views (optional)

In Settings → In-sim Panel, enable **Auto-hide from external views (in-sim panel only)**. It defaults off. Reinstall the cockpit panel from Settings to update an older installed wrapper. The panel stays loaded and becomes visible again in cockpit view. The desktop display is unaffected. The implementation recognizes the SDK's named chase, fixed, environment, showcase and drone states; ambiguous/unknown values remain visible. The [MSFS 2024 Camera Variables documentation](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/simvars/camera-variables/) inconsistently describes value 9, so it is not used as proof of an external view. Live MSFS and VR validation is still needed.
### First use
1. Click **Edit profiles** in the main window to open the Profiles editor, or **Settings** for app-wide preferences.
2. In **Profile mode**, choose **Auto-detect** (the default) to use the exact known glider’s WSG.org defaults when available, or **Manual** to select a profile yourself. The three historical native examples are now labeled Demo fixtures for offline testing, not Live defaults. Existing profile files, edits, preferences and assignments are preserved.
3. Select Manual ballast slider (the default for a new local profile) or Live flying weight. In Manual mode no weight anchors are required. Live mode requires both positive loaded Light and Heavy reference weights (entered in the selected kg/lb unit, stored in kg), with Light below Heavy, before saving. Existing profiles infer the mode from the anchors; no extra mode field is stored. MSFS supplies actual weight in Live mode. Manual ballast position is saved per profile. A profile with both weights never falls back to manual ballast on missing or stale telemetry.

Your data lives in `%APPDATA%\FlapHappy\`:
- `profiles\<name>.json`: one file per profile (readable, shareable; drag a `.json` onto the window to import).
- `settings.json`: main/external window positions, zoom, profile choices, and external-on-launch preference. Manual ballast preferences are retained per profile and used in manual ballast mode. Personal WSG adjustments also stay here.

Saving writes a `.bak` next to the file first; deleted profiles are kept as `.deleted.bak`.

## Developer setup

```
npm install
npm run start:demo     # Electron window on simulated data + dev panel
npm start              # Electron window talking to MSFS via SimConnect
npm run harness        # build + static server; open http://127.0.0.1:5173/?seed=demo in Chrome/Edge
npm run check          # typecheck + unit tests + build + Coherent-safe lint
npm run test:ui        # browser + Electron tests (Playwright with a system Chrome; Linux needs xvfb-run for Electron)
```

Browser harness query options: `?seed=demo|none`, `&dev=0` (hide dev panel), `&compact=1`. Only `demo` loads the three built-in profiles.

### Command-line flags

Use these after `npm start --` or on the Windows executable. Flags with values accept either
`--name=value` or `--name value`; quote paths containing spaces. Boolean flags use the bare switch
(or explicitly `=true` / `=false`).

| Flag | Meaning |
| --- | --- |
| `--source=simconnect\|simulated\|replay` | Data source (default `simconnect`). A saved Demo-mode setting takes precedence; `simulated` always selects Demo. |
| `--dev` | Show the development controls (always on for `--source=simulated`). |
| `--record=<file.jsonl>` | Append connected telemetry samples to a trace file. |
| `--trace=<file.jsonl>` | Input trace when using `--source=replay`; required for replay. |
| `--speed=<number>` | Replay speed multiplier (positive finite number, default 1). |
| `--loop` | Repeat the replay trace. |
| `--protocol=SunRise\|KittyHawk\|FSX_SP2\|FSX_SP1` | SimConnect protocol (default `SunRise`, MSFS 2024). |
| `--user-data=<absolute-folder>` | Use an alternate data folder in place of `%APPDATA%\FlapHappy`. Use the same folder for subsequent launches or exit requests. |
| `--show` | Conventional second-launch argument: restore/focus the running main window, or start it normally if not running. An ordinary launch does the same. |
| `--quit` | Ask the running instance to exit; if none is running for that data folder, exit without starting one. |
| `--compact` | Legacy compatibility switch; does not change the framed main window. |
| `--smoke` | Developer startup check: print a smoke result and exit with a success/failure code. |
| `--screenshot=<file.png>` | Developer capture of the main window after startup, then exit. Use an existing writable output directory; may be combined with `--smoke`. |
| `--airspeed-unit=kt\|kmh\|mph` | Session-only airspeed unit for the panels and editor. |
| `--weight-unit=kg\|lb` | Session-only flying-weight unit. |
| `--altitude-unit=ft\|m` | Session-only altitude/AGL unit. |
| `--wind-unit=kt\|mps` | Session-only independent wind-speed unit. |

On a second launch, the existing instance is restored; data source, replay, recording and
developer arguments do not reconfigure that running instance. Valid supplied display-unit arguments are the
exception (see **Optional display units on launch** below).

Unknown or obsolete flags such as `--panel-only` and `--serve` are ignored; they do not create a
hidden or server-only mode. Use `npm run harness` for the browser harness.
Unrecognized source/protocol values use their defaults; invalid replay multipliers use 1.
Path switches need actual paths; in particular, never pass a bare or empty `--user-data`.
Replay needs a readable trace, and recording/screenshot output paths must be writable.

Examples:
- `npm start -- --source=simulated` (no simulator needed).
- `npm start -- --source=replay --trace=tests/fixtures/sample-trace.jsonl --speed=2 --loop`.

The sample trace is in `tests/fixtures/sample-trace.jsonl`. Use `--record` to capture a trace for later replay
(useful for bug reports).

### Build the exe (on Windows)

Double-click **`Build portable exe.bat`**, or:

```
npm install
npm run dist:portable      # release\FlapHappy-1.0.0-portable.exe
npm run dist:win           # portable + installer
```

The exe is unsigned. Its icon is the same glider as the VR toolbar. The config was also cross-built once on Linux as a sanity check, but that exe has not been run on Windows.

## How it is organised

```
core/       pure TypeScript, no DOM/Node: profile model, validation, ballast math, scale/marker math,
            current-flap resolver (index -> percent -> L: var -> "FLAP ?"), display-model builder
ui/         plain DOM view code (strip, weight indicator / manual ballast slider, settings editor, app orchestrator)
adapters/   DataSource / ProfileStore / Host implementations:
              simulated/  SimulatedSource, ScenarioPlayer, ReplaySource, MemoryProfileStore, dev panel
              electron/   SimConnectSource (main process), FileProfileStore, bridge adapters (IPC)
app-electron/  main process, preload (whitelisted bridge), CLI parsing
profiles/   offline Demo examples shipped with the app (AS33-18m, AS33-15m, JS3)
build/      esbuild build, harness server, Coherent-safe lint
tests/      unit (core + adapters) and ui (Playwright)
```

The desktop UI talks to three adapter interfaces (data, profiles, and host). The main process keeps SimConnect and serves a shared ribbon page on localhost for the in-sim and external windows.

Coherent-safe rules, enforced by `npm run lint:coherent` and by compiling the renderer to ES2015 and checking it with es-check: flexbox and absolute positioning only (no grid, `gap`, CSS variables), no `ResizeObserver`, `localStorage`, `fetch`, clipboard, pointer events, `Object.entries`, `padStart`; mouse and touch events only.

### Profiles

**WSG.org default profiles for known flapped gliders.** Flap Happy automatically reads the
[public WSG.org catalog](https://wesimglide.org/api/flap-happy/catalog-v2.json) for each known flapped
glider variant with a published profile. No login, account, API key or setup checkbox is needed.
The catalog provides variant-specific flap order/handle mapping, loaded Light and Heavy weights,
IAS transition speeds, optional landing-flap stall IAS and default transition visibility. The
catalog is dynamic; for example, revision 27 contains 11 exact variants. A validated last-known-good
local cache supports outages. Published choices are listed alongside local profiles; an unusable
profile is marked for review rather than activating with assumed data.

- **Auto-detect** (default): a saved explicit local aircraft binding takes priority. Otherwise,
  the app resolves an unambiguous WSG variant using the installed aircraft add-on alias and
  wingspan, verifies its reference and flap mapping, then uses its published profile plus any
  personal adjustments. Only after that does an unambiguous local TITLE rule or a configured
  **Fallback profile** apply. The fallback defaults to None; an unknown aircraft never uses
  the last unrelated glider automatically. Full simulator paths and TITLE stay local.
- **Manual:** choose the **Active profile** explicitly from published WSG variants or saved custom
  profiles. Demo also offers the three offline examples, independent of the catalog or network.
- **Edit profiles:** inspect a published WSG profile without changing the active assignment,
  select a saved custom profile, create a local profile, or use **Custom profile...** to import
  a compatible local JSON file. Saved local profiles remain usable without WSG.org.

**Personal adjustments.** WSG defaults are read-only and select live flying weight by default.
In the Profiles editor, select the exact WSG variant and choose local adjustments to weight mode,
reference weights, stall/transition IAS, optional upper IAS limit or transition visibility.
Blank override inputs inherit the published baseline; **Save personal adjustments** stores only
your overrides, keyed to the exact variant and flap mapping. For example, local Manual ballast
is available without changing the published weights. **Reset to WSG defaults** removes those
local overrides. No profile edit writes back to WSG.org. If the published mapping changes or
a curve is invalid, review/reset the override instead of applying it to a different glider.

Published VNE is TAS and is used only as the ribbon's visual upper bound when applicable; it is
never an IAS warning threshold. A missing stall pair contributes a visual lower bound, not a
verified stall speed. See **Ribbon bounds** below.

#### Native/local profile format

A profile has N flap rows (any N from 0 up; each row: label, a sim index you type in) and exactly max(0, N-1) transitions, an optional stall IAS pair and a Vne IAS upper limit. Saved speeds are metres per second to two decimal places; the display converts them to whole kt, km/h or mph. With both anchors supplied, the read-only weight indicator interpolates stall and transition speeds between the explicit Light and Heavy loaded weights. Weights outside this interval clamp only the interpolation; absent or stale telemetry leaves the ribbon unavailable in this mode. For a local profile without both anchors, the manual ballast slider instead uses the original No/Max Ballast speed columns and saved per-profile position, independent of total-weight telemetry. Existing profiles retain their speed columns and legacy fields; no reference weights are guessed. VNE is one speed, saved as `vne_ms`. Validation (inline, with a summary box) requires strictly ascending speeds at both weight endpoints; buckets narrower than 4 kt warn, narrower than 2 kt are errors. The display shows an error/incomplete message instead of misleading data when a profile is not valid.

**Simple flap indicator (optional).** In Settings, enable Simple flap indicator to replace the IAS, flap ribbon and transition numbers with a large centered current flap and a directional recommendation: a filled triangle points left to a slower profile row or right to a faster one, with a centered amber label. No recommendation is shown if the current row is already correct, the IAS is above an applicable IAS limit or unavailable, or telemetry/profile/mapping is not valid. This uses the profile's ordered speed buckets and current effective flying weight or manual ballast setting; it does not introduce a new speed table. It is off by default, persists locally, and is shared by the desktop and cockpit panel. The Flap transitions switch is disabled while Simple mode is selected but keeps its prior value; the Ballast and AGL bars remain independently configurable.

## Choices and deviations worth knowing
- Schema ids are `flaphappy.profile/3` and `flaphappy.settings/1`. Files with another schema id are rejected. The optional `weight_kg` object stores `light` and `heavy` loaded masses in kg. Older app versions can read the existing speed data but do not preserve the new weight anchors if they re-save a profile.
- Minimum window content width is 560 px, growing with the flap count (`N*64+256`), so very large N scales instead of getting unreadable.
- Extra warnings were added when the profile has more rows than the sim reports handle positions for ("live count" check).
- The renderer is compiled with esbuild target `es2015` (not newer) to match the Coherent engine.
- There is no `--serve` mode; the browser harness is `npm run harness`.
- The three bundled examples are virtual Demo profiles, available offline. Live uses the published WSG.org catalog and local profiles. Existing saved starter files keep their IDs and are never reseeded.
- The dev panel, scenarios and fault injection (index missing/out of range, percent only, L: var only, unreadable, stale) exist so the whole fallback chain can be exercised without the sim.

## Tests
- Run `npm test` and `npm run test:ui` for unit and browser/Electron checks.

## Only verifiable on Windows with MSFS 2024
Everything above runs and is tested without the sim. These need a real Windows machine and MSFS:
1. `node-simconnect` connects to MSFS 2024 with the `SunRise` protocol and no extra DLL/config; reconnects after the sim is closed and restarted.
2. The data definition really returns what the code expects for the AS 33 Me: flap handle index and count, flap percent, aircraft `TITLE` (used for auto-selecting a profile), and the optional `L:` variable (set in Advanced).
3. Which handle indices the AS 33 Me actually reports. The editor shows the live handle index so each profile row can be matched to the lever.
4. Sample rate and behaviour on pause, menus, loading and slew (the "Paused" / "No data" states).
5. Always-on-top over MSFS in windowed, borderless and true fullscreen modes (the app uses the highest topmost level; exclusive fullscreen may still hide it).
6. Packaging: the portable exe starts, SmartScreen behaviour, `%APPDATA%\FlapHappy` creation, file open/save dialogs, "Open profiles folder".
7. Cockpit panel: Settings → In-sim Panel → **Enable in-sim panel**, then restart MSFS. In the cockpit (including VR) press Tab and open **Flap Happy**. The main application must be running; the external flight ribbon is optional.
8. The `--record` trace from a real flight replays correctly with `--source=replay`.


### In-sim panel installation management

Settings → In-sim Panel: choose the detected MSFS 2024 Community folder or an existing custom add-ons library parent. Browse is available only for a custom destination. Selecting the detected Community folder directly normalizes to Default Community.

Enable installs the verified bundled panel, disabling removes a verified physical install. An installed older package exposes Update and a Settings badge. Equal or newer versions are not overwritten. This is a bundled-version check, not a desktop release checker. Close MSFS before making changes. A custom package may be linked by MSFS Addons Linker; Flap Happy never creates or removes those links. Unlink before removing. Changing destination does not move the existing package; remove/unlink the old installation explicitly first. If a target is unfamiliar, damaged, duplicated or linked to another package, the app refuses to overwrite it. Updates stage on the destination volume outside Community and roll back on a failed swap.

### Merged flap bands
In Settings, choose **Hide** in its In-flight display column for a transition to omit that speed divider and merge its two adjacent flap labels. Consecutive exclusions form a single band. The actual simulator handle and its exact label are preserved. The optional exclusion is saved with each transition; legacy profiles remain unchanged, and excluded transition speeds are not needed until the divider is shown again.

### Responsive speed-trigger labels
When **Flap transitions** is enabled, the whole-number speed labels occupy a single row where their measured text widths fit. Crowded labels alternate between two rows while remaining aligned with the real dividers. Extremely dense values remain available on the dividers rather than overlapping neighboring text. The IAS calculations and units are unchanged.

### Recommendation highlight
Enable **Highlight suggested flap** in Settings to highlight the different flap band suggested by the current IAS in the full ribbon (light amber). The actual handle stays blue. It defaults off, and no highlight is shown on the ground, when the live handle/IAS or valid speeds are unavailable, above an applicable IAS limit, or when the suggestion matches the actual band.

### App-wide display units
Open **Settings > Display** to choose preferred airspeed, weight, altitude and independent wind-speed units. These preferences apply to all gliders, both panels and the profile editor. The Profiles section has no per-glider unit selector; native profile JSON keeps speeds in metres per second and weight anchors in kilograms.

### Desktop control window and Settings
The main window displays simulator connection, detected aircraft, active profile and source, and whether the external panel is open. **Edit profiles** opens the detailed editor, while **Settings** opens three keyboard-accessible areas: **Display** (global units, display toggles, AGL and appearance), **In-sim Panel** (package and auto-hide), and **Profiles** (glider definitions and local adjustments). Switching between Settings areas does not save or discard profile edits. Panel rendering and data formats are unchanged.

### Profile editing

The speed inputs use the app-wide speed unit and accept one decimal place. Unedited saved values keep their original precision. Unit conversion avoids intermediate rounding; native profile JSON still stores two-decimal m/s. Light, Heavy and In-flight display share one transition row; the selector includes room for the native dropdown arrow and full WSG default label, and reflows on narrow windows. Demo examples are available in the Demo session picker, not in Edit profiles. Delete profile is shown only for saved local profiles, with named confirmation; deletion clears references to that ID and retains a recoverable backup on disk. WSG defaults and virtual examples cannot be deleted. A retained personal WSG stall pair needs explicit confirmation if its reference weights change or its recorded detent is not the most-positive landing flap. Hiding a transition does not change the stall reference. An unconfirmed older pair is preserved locally but not used as stall IAS.

### Ribbon bounds

A supplied stall IAS is interpolated at the active weight/ballast. If no stall IAS pair is supplied, the lower edge is one median adjacent visible-trigger gap below the first trigger (never below zero), or zero with fewer than two triggers. This is display geometry only, not a stall speed or LOW warning. A WSG profile uses the numerical published VNE TAS in the chosen speed unit for the upper ribbon edge whenever it accommodates all visible transitions; it is not an IAS warning or recommendation cutoff. Explicit personal IAS limits retain their warning semantics.

### Demo flap positions

Selecting a different profile in Demo sets the synthetic flap count from its native handle mapping and clamps the handle index. A different anchored glider starts at its own synthetic Light weight; edits and missing-weight tests on the same glider remain untouched. Use the linked weight slider and kg input (280-1000 kg by default, 1 kg steps). The range expands for custom anchors or positive typed values outside that span. Clear the numeric value to test unavailable weight; real telemetry and saved profiles are unaffected. The Dev count remains editable for mismatch testing; **Use profile count** restores the selected mapping. A WSG flap-count mismatch reports expected and received counts and suspends guidance; real MSFS telemetry is never adjusted to match a profile.

For valid in-flight IAS below the ribbon floor, both recommendation displays still identify the slowest displayed flap group if a change is needed. This remains true at all nonnegative IAS values, including zero; the 25 kt visual grey-bar threshold does not suppress suggestions. Explicit on-ground, missing or invalid IAS, and stale telemetry still suppress recommendations. At or above the visual grey-bar threshold, a supplied stall IAS retains its LOW warning and the IAS marker clamps at the lower edge; a visual-only lower edge does not create a stall warning.

**Group hidden flap labels** (Display, off by default) controls the label text for adjacent flap detents with a hidden divider. Off displays the surviving last label (e.g. `5`); On displays all labels (e.g. `L-6-5`). Divider positions, exact handle mapping and recommendation groups remain the same. The setting is shared by the desktop and in-sim display.

### Optional display units on launch

Normal launches use the saved standalone Display settings. The separate choices are Airspeed (`kt`, `kmh`, `mph`), Weight (`kg`, `lb`), Altitude (`ft`, `m`) and Wind (`Follow airspeed` by default, `kt`, `mps`). Existing settings retain their former wind behavior and default kg. Profile data and telemetry retain their canonical units; preferences change only conversion for display and new edits.

A launcher can opt in per preference, for example `"Flap Happy.exe" --airspeed-unit=mph --weight-unit=lb --altitude-unit=m --wind-unit=mps`. Values are validated independently, and unknown or omitted flags do not replace a choice. Wind’s Follow airspeed option is a standalone setting; the CLI accepts only kt or mps for wind. Unit flags use the exact lowercase tokens in the table. Inherited choices are locked for the process and do not change the saved standalone preferences. Calling the executable again updates only the supplied valid preferences in the already-running session; without flags it simply focuses the app. If Settings was already open, finish or discard your existing edits and reopen it to see the refreshed units. Both external and in-sim panels use the same effective choices. The Demo controls continue to edit explicitly labelled native test values (kt, kg, ft).
