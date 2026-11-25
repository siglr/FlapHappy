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
controls and can be minimized or closed to exit. It contains **Settings and profiles**,
a **Show external panel / Close external panel** button, and a separate **Open the external
panel on launch** checkbox (off by default). This checkbox is saved across restarts;
manually opening or closing the ribbon does not change it.

The external ribbon and in-sim panel use the same locally served display. The main process
owns the telemetry and saved profiles, so closing the external panel or minimizing the main
window does not stop the feed. External always-on-top, opacity and zoom remain available in
Settings. Closing the main window exits the app and closes the external panel too.
A second launch (or `--show`) restores the existing main window; `--quit` exits the session.
The previous experimental windowless launch flag is no longer a windowless mode.

### First use
1. Click Settings and profiles in the main window.
2. A new install, or an empty profile folder, gets **AS33-18m**, **AS33-15m**, and **JS3**. AS33-18m opens first. Profiles already in the folder are not copied again.
3. Select Manual ballast slider (the default for a new local profile) or Live flying weight. In Manual mode no weight anchors are required. Live mode requires both positive loaded Light and Heavy reference weights (kg), with Light below Heavy, before saving. Existing profiles infer the mode from the anchors; no extra mode field is stored. MSFS supplies actual weight in Live mode. Manual ballast position is saved per profile. A profile with both weights never falls back to manual ballast on missing or stale telemetry.

Your data lives in `%APPDATA%\FlapHappy\`:
- `profiles\<name>.json`: one file per profile (readable, shareable; drag a `.json` onto the window to import).
- `settings.json`: main/external window positions, zoom, profile choices, and external-on-launch preference. Manual ballast preferences are retained per profile and used only when either weight anchor is absent.

The optional **Browse WSG.org published profiles** setting fetches the public, anonymous catalog when the editor is opened (no login, token or API key). It defaults off; local profiles remain available offline. Published variants are listed by their exact keys and previewed without changing the current local profile or its title selection. With MSFS connected, a remembered explicit local aircraft binding wins; only an unambiguous local title rule may auto-select a local profile. Unknown aircraft do not inherit the last flown profile. If opted in, the app resolves a literal WSG alias from the local installed add-on container and wingspan, then confirms the canonical public reference and flap mapping. The complete simulator path and TITLE are never sent to WSG. Verified exact WSG profiles activate with merged display bands and optional personal adjustments. Missing stall IAS and upper IAS limits do not generate warning states; the TAS VNE number is only a visual scale bound, never an IAS limit.

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

Command line flags (after `npm start --` or on the exe):

| Flag | Meaning |
| --- | --- |
| `--source=simconnect\|simulated\|replay` | data source (default `simconnect`) |
| `--dev` | show the dev panel (always on for `simulated`) |
| `--record=file.jsonl` | write every sample to a trace file |
| `--trace=file.jsonl` `--speed=2` `--loop` | replay a trace (with `--source=replay`) |
| `--protocol=SunRise\|KittyHawk\|FSX_SP2\|FSX_SP1` | SimConnect protocol (default `SunRise`, MSFS 2024) |
| `--user-data=<dir>` | use another folder instead of `%APPDATA%\FlapHappy` |
| `--compact` | accepted for compatibility; the main window always stays framed |

A sample trace is in `tests/fixtures/sample-trace.jsonl`. `--record` is how you capture a real flight to replay later (useful for bug reports).

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
profiles/   built-in profiles shipped with the app (AS33-18m, AS33-15m, JS3)
build/      esbuild build, harness server, Coherent-safe lint
tests/      unit (core + adapters) and ui (Playwright)
```

The desktop UI talks to three adapter interfaces (data, profiles, and host). The main process keeps SimConnect and serves a shared ribbon page on localhost for the in-sim and external windows.

Coherent-safe rules, enforced by `npm run lint:coherent` and by compiling the renderer to ES2015 and checking it with es-check: flexbox and absolute positioning only (no grid, `gap`, CSS variables), no `ResizeObserver`, `localStorage`, `fetch`, clipboard, pointer events, `Object.entries`, `padStart`; mouse and touch events only.

### Profiles in brief
A profile has N flap rows (any N from 0 up; each row: label, a sim index you type in) and exactly N-1 transitions, plus Vs and Vne. Saved speeds are metres per second to two decimal places; the display converts them to whole kt or km/h. With both anchors supplied, the read-only weight indicator interpolates stall and transition speeds between the explicit Light and Heavy loaded weights. Weights outside this interval clamp only the interpolation; absent or stale telemetry leaves the ribbon unavailable in this mode. If either anchor is blank, the manual ballast slider instead uses the original No/Max Ballast speed columns and saved per-profile position, independent of total-weight telemetry. Existing profiles retain their speed columns and legacy fields; no reference weights are guessed. VNE is one speed, saved as `vne_ms`. Validation (inline, with a summary box) requires strictly ascending speeds at both weight endpoints; buckets narrower than 4 kt warn, narrower than 2 kt are errors. The display shows an error/incomplete message instead of misleading data when a profile is not valid.

## Choices and deviations worth knowing
- Schema ids are `flaphappy.profile/3` and `flaphappy.settings/1`. Files with another schema id are rejected. The optional `weight_kg` object stores `light` and `heavy` loaded masses in kg. Older app versions can read the existing speed data but do not preserve the new weight anchors if they re-save a profile.
- Minimum window content width is 560 px, growing with the flap count (`N*64+256`), so very large N scales instead of getting unreadable.
- Extra warnings were added when the profile has more rows than the sim reports handle positions for ("live count" check).
- The renderer is compiled with esbuild target `es2015` (not newer) to match the Coherent engine.
- There is no `--serve` mode; the browser harness is `npm run harness`.
- `profiles/as33-18m.json`, `profiles/as33-15m.json`, and `profiles/js3.json` are copied into an empty profile folder on first launch. AS33-18m opens first. An id that is already present is not written again.
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
7. Cockpit panel: Settings → Window and app → **Install cockpit panel**, then restart MSFS. In the cockpit (including VR) press Tab and open **Flap Happy**. The main application must be running; the external flight ribbon is optional.
8. The `--record` trace from a real flight replays correctly with `--source=replay`.
