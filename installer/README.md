# AI-Kit Global Installer

Installs AI-Kit **1.0.0** into a per-user home so one runtime backs every project.

| OS | Default install location |
|----|--------------------------|
| Linux / macOS | `/home/<user>/ai-kit/` (`$HOME/ai-kit`) |
| Windows | `C:\Users\<user>\ai-kit\` (`%USERPROFILE%\ai-kit`) |

Override with `--home <dir>` (bash) / `-Home_ <dir>` (PowerShell) or the
`AIKIT_HOME` environment variable.

The repository-root `install.sh` and `install.ps1` are the canonical device
entrypoints and forward to this installer. Project-local mode is explicit:
`installer/install-project.sh` or `installer/install-project.ps1`.
Run the device installer once per machine; it is not repeated for each
project. Launchers always keep project state in the current project's
`.ai-work/` directory.

## Configure A Workspace

After the device install, configure each workspace with the compatibility
bridges. This creates the complete `.ai-work/` data tree, `AGENTS.md`, and
entrypoints for Copilot, Claude, Codex, Cursor, Gemini, and VS Code without
installing a second runtime into the workspace:

```bash
bash installer/configure-workspace.sh --target /path/to/workspace
```

On Windows:

```powershell
.\installer\configure-workspace.ps1 -Target C:\path\to\workspace
```

The project-local installer remains available only for projects that
explicitly require a private runtime under `.ai/node`.

## Install

Linux / macOS:

```bash
bash installer/install.sh
# Install the device runtime and configure a workspace in one step:
bash installer/install.sh --workspace /path/to/workspace
export PATH="$HOME/ai-kit/bin:$PATH"   # add to ~/.bashrc or ~/.zshrc
ai-kit version
```

After this one-time device install, a new project is initialized from its own
root with the global runtime:

```bash
cd /path/to/new-project
ai-kit setup
ai-kit status
```

`ai-kit setup` creates `.ai-work/`, `AGENTS.md`, and the compatibility bridges
for VS Code, Copilot, Claude, Codex, Cursor, and Gemini. The runtime remains
in `~/ai-kit`.

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File installer\install.ps1
$env:Path = "$env:USERPROFILE\ai-kit\bin;" + $env:Path   # add to your profile
ai-kit version
```

Flags: `--force` / `-Force` (replace an existing install), `--dry-run` /
`-DryRun` (preview only), `--no-deps` / `-NoDeps` (skip `npm install`).

## What gets installed

Into `~/ai-kit/`:

- `.ai/` — the runtime (`.ai/node`), knowledge (`agents`, `skills`, `workflows`),
  plugins, capabilities, and config (`kit.yaml`, `models.yaml`, `security.yaml`).
- `plugins/ prompts/ workflows/ models/ templates/ config/ cache/ logs/` — the
  flat home skeleton for **your** global extensions (project plugins still win).
- `bin/ai-kit` (+ `ai-kit.cmd`) — the CLI launcher.
- `bin/ai-kit-worker`, `bin/ai-kit-gate`, and `bin/ai-kit-plugin` — worker,
  gate, and plugin-runner launchers.

Node dependencies are installed per platform (the esbuild binary is
platform-specific), so the same home works after re-running with `--no-deps` on
a new OS is not enough — run a normal install per platform.

## How state works

The launchers set `AIKIT_PROJECT_ROOT` to the current directory and
`AIKIT_WORK` to `<current directory>/.ai-work` unless you set them yourself.
The runtime and knowledge come from the global home, while each project keeps
its own workflow state and executes provider commands in its own directory:

```bash
cd ~/projects/my-app
ai-kit init --title "My app" --workflow feature   # writes ./.ai-work
ai-kit status
ai-kit-worker start --workflow-id default --role executor
ai-kit-gate default --once --verify
```

## Uninstall

Remove the home directory and the PATH entry:

```bash
rm -rf ~/ai-kit
```
