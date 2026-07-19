# AI-Kit VS Code Extension (thin client)

UI only. This extension contains **no** AI or orchestration logic. Every command
runs the AI-Kit runtime directly with Node and renders the JSON result. It
prefers a project-local `.ai/node` runtime, then falls back to `AIKIT_HOME` or
`~/ai-kit`, so a project using a global install only needs `.ai-work`.

## The AI-Kit view

Click the AI-Kit icon in the Activity Bar for a live tree with six sections,
each backed by an AI-Kit CLI call:

- **Workflow** — title, revision, status counts, phases (`ai-kit status`).
- **Task Tree** — every task with a status icon; expand for owner / phase / needs /
  blocked reason (`ai-kit show`).
- **Current Step** — in-progress and ready tasks (`ai-kit ready`).
- **Providers** — role → plugin → provider binary (`ai-kit providers`).
- **Logs** — the most recent workflow events (`ai-kit timeline`).

Use the title-bar buttons to **Refresh** and **Run Gates**. Set
`aiKit.autoRefreshSeconds` to poll automatically.

Control commands (Command Palette; prompt for a registered workflow id):

- **AI-Kit: Start Executor / QA / Reviewer Worker** → `worker-manager start --workflow-id … --role …`
- **AI-Kit: Run Gates** → `gate-runner <workflow-id> --once`
- **AI-Kit: Stop Worker** → `worker-manager stop <worker-id>`

## Configuration

`aiKit.nodePath` (default `node`) — path to the Node.js binary used to run the
runtime.

`aiKit.home` (default empty) — optional global AI-Kit home. When empty, the
extension uses `AIKIT_HOME` or `~/ai-kit` if no project-local runtime exists.

## Test it in VS Code (F5)

Prerequisites: Node.js ≥ 22, and a project that has AI-Kit installed and
bootstrapped (`bash .ai/scripts/bootstrap.sh`, which installs `.ai/node` deps).

1. Build the extension once:

   ```
   cd extension
   npm install
   npm run build
   ```

2. Create `extension/.vscode/launch.json` and `extension/.vscode/tasks.json` (VS Code
   protects these; paste the snippets below):

   `launch.json`

   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "name": "Run AI-Kit Extension",
         "type": "extensionHost",
         "request": "launch",
         "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
         "outFiles": ["${workspaceFolder}/dist/**/*.js"],
         "preLaunchTask": "npm: build"
       }
     ]
   }
   ```

   `tasks.json`

   ```json
   {
     "version": "2.0.0",
     "tasks": [{ "type": "npm", "script": "build", "problemMatcher": "$tsc", "group": "build", "label": "npm: build" }]
   }
   ```

3. Open the `extension/` folder in VS Code and press **F5**. A second window
   ("Extension Development Host") opens with the extension loaded.

4. In that window, open an AI-Kit project folder (**File → Open Folder**). The AI-Kit
   repo itself works as a test project.

5. Run **Ctrl/Cmd+Shift+P → "AI-Kit: Show Workflow Status"** (and the other AI-Kit
   commands). Output appears in the **AI-Kit** output channel.

### End-to-end (real providers)

To watch the full chain from the UI:

1. **AI-Kit: List Workflows** (create one first from a terminal:
   `node .ai/node/node_modules/tsx/dist/cli.mjs .ai/node/ai-kit.ts workflow-create demo --title Demo`).
2. **AI-Kit: Start Executor Worker** → enter the workflow id. With `claude`/`codex`
   configured in `.ai/models.yaml` and on PATH, the worker runs the real provider.
3. **AI-Kit: Run Gates** → enter the workflow id to run QA and close tasks that already have reviewer approval.
4. **AI-Kit: Show Workflow Status** to watch it reach `done`.

Without provider binaries installed, workers still run but tasks are marked
`blocked` (no artifact) — safe, and visible in **AI-Kit: Show Full State**.

## Package a `.vsix` (optional)

```
cd extension
npm install
npx @vscode/vsce package --no-dependencies
```

Then install the produced `ai-kit-vscode-1.0.0.vsix` via
**Extensions → … → Install from VSIX**.

## Design boundary

The extension is replaceable and disposable. All behavior — planning, execution,
gating, and provider selection — lives behind the runtime, so the same engine can
back the CLI or any other UI without change.
