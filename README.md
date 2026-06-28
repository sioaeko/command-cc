# command-cc

[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org/)
[![Claude Code gateway](https://img.shields.io/badge/Claude%20Code-local%20gateway-111827)](#how-it-works)
[![Command Code](https://img.shields.io/badge/Command%20Code-app%20API-2563eb)](https://commandcode.ai/)
[![Kiro Gateway](https://img.shields.io/badge/Kiro-Gateway-7c3aed)](#kiro-gateway-wrapper)
[![Windows tested](https://img.shields.io/badge/Windows-tested-0078d4)](#development)

Run your own Claude Code installation from any folder while routing model calls through your logged-in Command Code account, or through a separately installed Kiro Gateway.

![command-cc model picker inside Claude Code](assets/command-cc.png)

## Important Scope

`command-cc` does not bundle, redistribute, include, fork, patch, or modify Claude Code. It is only a local wrapper and gateway that launches the Claude Code CLI already installed on your machine.

`kiro-cc` follows the same rule. It does not bundle, redistribute, include, fork, patch, or modify Kiro, Claude Code, or Kiro Gateway. It only installs/runs [Jwadow/kiro-gateway](https://github.com/Jwadow/kiro-gateway) as a separate local checkout and points your installed Claude Code CLI at that local Anthropic-compatible endpoint.

The wrapper exists to let a logged-in Command Code Go plan use Command Code models from inside Claude Code. It is not an official Anthropic, Claude Code, or Command Code distribution, and it is not affiliated with or endorsed by those services.

The Kiro wrapper exists to let your logged-in Kiro CLI account be used through Kiro Gateway from inside Claude Code. It is not an official AWS, Kiro, Anthropic, Claude Code, or Kiro Gateway distribution, and it is not affiliated with or endorsed by those services.

```text
Claude Code
    -> local Anthropic-compatible gateway
        -> Command Code model discovery
        -> Command Code app generation API
```

```text
Claude Code
    -> local Anthropic-compatible Kiro Gateway
        -> Kiro CLI account credentials
        -> Kiro model API
```

`command-cc` and `kiro-cc` are global CLI wrappers. Install once, then run either inside any repository just like `claude`.

## Quick Start

```powershell
npm install -g .
command-cc login
command-cc doctor
command-cc
```

The default model is `deepseek-v4-flash`. The default picker is capped by Claude Code's current UI shape: one built-in `Default` row, five custom slots, and the checked current model. `command-cc` keeps `deepseek-v4-pro`, `mimo-v2.5`, and `mimo-v2.5-pro` in the visible slots; `qwen3.7-max` remains allowed and can be launched directly with `--model qwen3.7-max`.

Claude Code owns the text on its built-in `Default (recommended)` row. `command-cc` sets the real active model through `ANTHROPIC_MODEL` and the checked picker row; forcing Claude Code's internal default label currently collapses the custom picker rows, so this wrapper keeps the multi-model picker working instead.

Inside Claude Code:

```text
/model
```

For Claude Code Desktop / GUI local sessions:

```powershell
command-cc gui
```

Keep that terminal open, then open Claude Desktop / Claude Code GUI, choose a Local environment, and start a session.

For DeepClaude-style browser Remote Control:

```powershell
command-cc remote
```

For a one-shot prompt:

```powershell
command-cc --model xiaomi/mimo-v2.5-pro -- -p "explain this repo"
```

### Kiro Gateway Quick Start

`kiro-cc` is separate from `command-cc`. It uses your Kiro CLI login and an external Kiro Gateway checkout under `~/.command-claudecode/kiro-gateway`.

Requirements:

```powershell
# Kiro CLI must already be installed and logged in
kiro-cli login

# Python 3.10+ and git must be available
python --version
git --version
```

Install/update the local Kiro Gateway checkout, then launch Claude Code through it:

```powershell
kiro-cc setup
kiro-cc doctor
kiro-cc models
kiro-cc --model auto
```

Pick a specific Kiro model:

```powershell
kiro-cc --model claude-sonnet-4.6
kiro-cc --model deepseek-3.2
kiro-cc --model qwen3-coder-next
```

Start the local Kiro adapter plus its upstream Kiro Gateway:

```powershell
kiro-cc serve --port 8000
```

`kiro-cc` stores only wrapper config in `~/.command-claudecode/kiro-cc.json`. Kiro credentials remain in the Kiro CLI database; the generated local proxy key stays in the external gateway `.env` file.

## What You Get

| Feature | What it does |
| --- | --- |
| Global launcher | Run `command-cc` from any project, using your existing Claude Code install. |
| GUI bridge | Configure Claude Code Desktop / GUI local sessions and run a fixed-port local gateway. |
| Remote Control bridge | Start `claude remote-control` with model requests routed through Command Code. |
| Kiro bridge | `kiro-cc` launches Claude Code through a separately installed Kiro Gateway. |
| Command Code login reuse | Reads the official Command Code login from `~/.commandcode/auth.json`. |
| Kiro CLI login reuse | Reads Kiro Gateway credentials from the Kiro CLI SQLite database path. |
| Local gateway | Presents an Anthropic-compatible API to Claude Code on `127.0.0.1`. |
| Go-plan filtering | Shows the Go-friendly Command Code models when the logged-in account is on Go. |
| Model aliases | Maps clean ids like `mimo-v2.5-pro` back to real ids like `xiaomi/mimo-v2.5-pro`. |
| Usage checks | `command-cc usage` prints credits, token usage, request counts, and per-model usage. |
| Dry-run mode | `--dry-run` shows the exact Claude Code command/env without spending generation tokens. |
| Stale model cleanup | Removes old wrapper model defaults like `claude-mimo-v2.5-pro` from Claude Code settings before launch. |

## Commands

| Command | Purpose |
| --- | --- |
| `command-cc` | Launch Claude Code through the local Command Code gateway. |
| `command-cc login` | Run the official Command Code CLI login and reuse that auth. |
| `command-cc status` | Delegate to the Command Code CLI status command. |
| `command-cc whoami` | Delegate to the Command Code CLI identity command. |
| `command-cc logout` | Delegate to the Command Code CLI logout command. |
| `command-cc models` | List available Command Code models and gateway picker ids. |
| `command-cc models --json` | Print the model list as JSON for scripts/debugging. |
| `command-cc usage` | Show Command Code credits and usage. |
| `command-cc usage --json` | Print raw usage/account/credit payloads as JSON. |
| `command-cc gui` | Configure GUI local-session env and start the foreground gateway. |
| `command-cc gui setup` | Write GUI local-session env into `~/.claude/settings.json` without starting the gateway. |
| `command-cc gui serve` | Start only the fixed-port GUI gateway. |
| `command-cc gui status` | Show the GUI env config and gateway health. |
| `command-cc gui uninstall` | Remove command-cc managed env keys from Claude Code settings. |
| `command-cc remote` | Start DeepClaude-style browser Remote Control through a local Command Code gateway. |
| `command-cc --remote` | Same as `command-cc remote`. |
| `command-cc doctor` | Check Claude Code, auth, plan detection, model discovery, and selected model. |
| `command-cc env` | Print Anthropic env vars for manual gateway wiring. |
| `command-cc serve` | Start only the local gateway. |
| `command-cc config get` | Show saved wrapper config. |
| `command-cc config path` | Print the config path. |

Kiro commands:

| Command | Purpose |
| --- | --- |
| `kiro-cc` | Launch Claude Code through a local Kiro Gateway. |
| `kiro-cc setup` | Clone/update Kiro Gateway, create a Python venv, install requirements, and write `.env`. |
| `kiro-cc login` | Run the installed Kiro CLI login flow. |
| `kiro-cc whoami` | Run Kiro CLI identity check. |
| `kiro-cc models` | List models visible to Kiro CLI without spending generation tokens. |
| `kiro-cc models --json` | Print Kiro CLI model list as JSON. |
| `kiro-cc serve --port 8000` | Start the local Kiro adapter plus its upstream Kiro Gateway. |
| `kiro-cc doctor` | Check Python, git, Kiro CLI, Claude Code, and gateway setup. |
| `kiro-cc --dry-run --model auto` | Print the Claude Code env/settings without starting the gateway. |

Installed aliases:

```powershell
command-cc
command-claudecode
claude-command-code
cmdclaude
ccclaude
kiro-cc
```

## Installation

Install from GitHub:

```powershell
npm install -g github:sioaeko/command-cc
```

Local development install:

```powershell
npm install -g .
```

Symlink while iterating:

```powershell
npm link
```

Install Command Code itself if login delegation cannot find it:

```powershell
npm i -g command-code@latest
```

## Authentication

The recommended flow is:

```powershell
command-cc login
```

That delegates to the official Command Code CLI (`cmdc login` on Windows, or `cmd login` where available). The wrapper then reads:

```text
~/.commandcode/auth.json
```

You usually do not need to paste an API key into this wrapper.

Auth/config priority:

| Source | Priority |
| --- | --- |
| `--api-key` | Highest |
| `$COMMAND_CODE_API_KEY` or custom `--api-key-env` | High |
| `$CMD_API_KEY` | High |
| Command Code login file | Recommended default |
| Wrapper config API key | Fallback |

Optional wrapper config lives at:

```text
~/.command-claudecode/config.json
```

## Configuration

Save a default model:

```powershell
command-cc config set model "xiaomi/mimo-v2.5-pro"
```

Persist picker behavior:

```powershell
command-cc config set clean-model-name false
command-cc config set filter-models-by-plan true
command-cc config set restrict-model-picker true
```

Show or clear config:

```powershell
command-cc config get
command-cc config unset model
```

Environment variables still override saved preferences:

```powershell
$env:COMMAND_CODE_MODEL = "xiaomi/mimo-v2.5-pro"
$env:COMMAND_CODE_API_KEY = "<command-code-api-key>"
```

## Kiro Gateway Wrapper

`kiro-cc` is an orchestrator around [Jwadow/kiro-gateway](https://github.com/Jwadow/kiro-gateway). The upstream gateway provides OpenAI-compatible `/v1/chat/completions` and Anthropic-compatible `/v1/messages`; this package starts it, places a tiny Node adapter in front of it for Claude Code request compatibility, and launches Claude Code with the right local env.

Install/update the external gateway:

```powershell
kiro-cc setup
```

What `setup` does:

| Item | Path / source |
| --- | --- |
| Gateway checkout | `~/.command-claudecode/kiro-gateway` |
| Python venv | `~/.command-claudecode/kiro-gateway/.venv` |
| Gateway env | `~/.command-claudecode/kiro-gateway/.env` |
| Kiro CLI SQLite auth | Windows default: `%LOCALAPPDATA%\Kiro-Cli\data.sqlite3` |
| Wrapper config | `~/.command-claudecode/kiro-cc.json` |

The external gateway's own license and terms apply to that checkout. This repo does not vendor the gateway source.

Model discovery uses Kiro CLI and does not spend generation tokens:

```powershell
kiro-cc models
kiro-cc models --json
```

Known model ids currently returned by the local Kiro CLI include:

```text
auto
claude-opus-4.8
claude-opus-4.7
claude-opus-4.6
claude-sonnet-4.6
claude-haiku-4.5
deepseek-3.2
minimax-m2.5
glm-5
qwen3-coder-next
```

Run without spending tokens to verify the Claude Code env:

```powershell
kiro-cc --dry-run --model claude-sonnet-4.6
```

Then launch:

```powershell
kiro-cc --model claude-sonnet-4.6
```

Claude Code's `/model` UI still has its normal custom-slot limits. `kiro-cc` passes Kiro model ids as clean model names and also enables gateway model discovery, but Claude Code may not render every Kiro model as a visible picker row at once. Direct `--model <id>` remains the reliable path.

## Model Picker Modes

Claude Code 2.1.x renders one built-in `Default` row plus five custom model slots, then adds the checked current model if it is not already in those slots. The built-in `Default` row mirrors Claude Code's Opus/default slot instead of adding a separate seventh Command Code model, so only six distinct Command Code models can be visible at once. The full Go-plan list is still allowed through gateway discovery and direct `--model` selection.

| Mode | Command | `/model` behavior | Best for |
| --- | --- | --- | --- |
| Default | `command-cc` | Starts on `deepseek-v4-flash`. In current Claude Code builds the visible rows are typically `Default`/`deepseek-v4-pro`, then `glm-5.2`, `deepseek-v4-pro`, `mini-max-m3`, `mimo-v2.5`, `mimo-v2.5-pro`, and the checked `deepseek-v4-flash` row. `qwen3.7-max` is still allowed; launch it with `command-cc --model qwen3.7-max`. | Switching among the main Go-plan models inside Claude Code. |
| Clean single-model | `command-cc --clean-model-name` | Uses prefix-free env ids like `mimo-v2.5-pro`; Claude Code may only show the selected model. | Deepclaude-style clean display for one model. |
| Full catalog | `command-cc --all-models` | Disables plan-aware filtering. | Checking everything Command Code exposes. |
| Built-in models allowed | `command-cc --allow-claude-model-list` | Does not restrict Claude Code's own picker list. | Debugging or comparing with native Claude models. |

Default Go-plan picker aliases currently look like:

| Real Command Code id | Claude Code visible alias |
| --- | --- |
| `zai-org/GLM-5.2` | `glm-5.2` |
| `deepseek/deepseek-v4-pro` | `deepseek-v4-pro` |
| `deepseek/deepseek-v4-flash` | `deepseek-v4-flash` |
| `nvidia/nemotron-3-ultra-550b-a55b` | `nemotron-3-ultra-550b-a55b` |
| `Qwen/Qwen3.7-Max` | `qwen3.7-max` |
| `MiniMaxAI/MiniMax-M3` | `mini-max-m3` |
| `xiaomi/mimo-v2.5-pro` | `mimo-v2.5-pro` |
| `xiaomi/mimo-v2.5` | `mimo-v2.5` |

When Claude Code sends `mimo-v2.5-pro`, the gateway forwards `xiaomi/mimo-v2.5-pro` to Command Code.

### Qwen 3.7 Max

`qwen3.7-max` is part of the Go-plan allowlist and remains usable through `command-cc`, but it may not appear in the default `/model` screen on Claude Code 2.1.x. Claude Code currently shows one built-in `Default` row, five custom slots, and the checked current model; because the visible slots prioritize `deepseek-v4-pro`, `mini-max-m3`, `mimo-v2.5`, and `mimo-v2.5-pro`, Qwen can be hidden from the picker even though the gateway still accepts it.

Run Qwen directly:

```powershell
command-cc --model qwen3.7-max
```

Save Qwen as your wrapper default:

```powershell
command-cc config set model qwen3.7-max
command-cc
```

Check that it resolves without spending tokens:

```powershell
command-cc --dry-run --model qwen3.7-max
```

`nvidia/nemotron-3-ultra-550b-a55b` is still recognized, but it is not in the default seven-item picker. Use `--model nemotron-3-ultra-550b-a55b` or `--all-models` if you want it.

## Claude Code Desktop / GUI

Claude Code Desktop local sessions do not always inherit the same shell env as your terminal. `command-cc gui` writes the required Claude env keys into your user `~/.claude/settings.json` under `env`, then starts a fixed-port local gateway:

```powershell
command-cc gui
```

Leave the command running while you use the GUI. In Claude Desktop / Claude Code GUI, choose the Local environment. Cloud and remote sessions cannot reach a local `127.0.0.1` gateway on your machine.

Important GUI limitation: Claude Desktop itself still requires Claude/Anthropic OAuth login and Claude Code entitlement before you can enter the Code tab. Free Claude plans are blocked before any Local Code session starts, so `command-cc` cannot bypass that screen. The wrapper only routes the Local session's model requests through the Command Code gateway after the GUI has already allowed the Code session to start.

Useful GUI commands:

```powershell
command-cc gui setup
command-cc gui serve
command-cc gui status
command-cc gui uninstall
command-cc gui --dry-run
```

### ConnectionRefused

If Claude Code prints `Unable to connect to API (ConnectionRefused)`, it is trying to call a local gateway port where no `command-cc` server is listening.

For CLI use, start Claude through the wrapper:

```powershell
command-cc
```

Do not start plain `claude` after running `command-cc gui setup`; the GUI setup stores `ANTHROPIC_BASE_URL=http://127.0.0.1:64726` in `~/.claude/settings.json`, and plain `claude` will try that port even if the gateway is not running.

For GUI use, keep the gateway process open:

```powershell
command-cc gui
```

Or split setup and serving:

```powershell
command-cc gui setup
command-cc gui serve
```

Check the gateway:

```powershell
command-cc gui status
```

Starting with `command-cc` 0.8.9, CLI launches also pass the current gateway port through `--settings.env`, so stale GUI settings cannot override the wrapper's live random port.

Default GUI gateway:

```text
http://127.0.0.1:64726
```

You can choose another fixed port:

```powershell
command-cc gui --port 48146
```

The GUI setup edits only the `env` keys managed by this wrapper and backs up the previous settings file in:

```text
~/.claude/backups/
```

## Remote Control

`command-cc remote` starts a DeepClaude-style Remote Control session:

```powershell
command-cc remote
```

What happens:

```text
claude remote-control
  -> Anthropic OAuth / Remote Control bridge stays with Claude
  -> model requests go to command-cc local gateway
  -> command-cc forwards generation to Command Code
```

This is not the Claude Desktop Code tab. It is Claude Code Remote Control, which opens a `claude.ai/code/session_...` browser URL while the local `claude` process keeps running.

Remote mode intentionally does not set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` for Claude Code. Those can break the Remote Control OAuth bridge. The Command Code key stays inside the local gateway process.

Pass Remote Control arguments after `--`:

```powershell
command-cc remote -- --name "Command Code session"
command-cc --remote -- --name "Command Code session"
```

Dry-run without starting Claude Code:

```powershell
command-cc remote --dry-run
```

Remote Control still requires Claude/Anthropic login and Remote Control eligibility. If Claude blocks your account before the local session starts, this wrapper cannot bypass that entitlement check.

## Go Plan Behavior

By default, the picker is filtered to seven priority Go-friendly models known to this wrapper. The wrapper keeps this filter even when Command Code account/plan endpoints are unavailable, because model discovery can still work while plan metadata is temporarily missing:

```text
deepseek/deepseek-v4-pro
deepseek/deepseek-v4-flash
zai-org/GLM-5.2
Qwen/Qwen3.7-Max
MiniMaxAI/MiniMax-M3
xiaomi/mimo-v2.5-pro
xiaomi/mimo-v2.5
```

Check what the wrapper sees:

```powershell
command-cc models
command-cc models --json
```

Bypass the filter:

```powershell
command-cc --all-models
command-cc models --all-models
```

Force it back on, even if config disables it:

```powershell
command-cc --plan-filter
```

## Usage And Credits

Check credits without starting Claude Code:

```powershell
command-cc usage
```

Example shape:

```text
Command Code usage
account: your-name
plan: individual-go (active)
period: 2026-06-15 -> 2026-07-15
credits: monthly 9.8689, purchased 0, free 0
usage: 0.1311 credits, 299,547 tokens, 27 requests
models:
  xiaomi/mimo-v2.5-pro    27 req    0.1311 credits
```

Use JSON for scripts:

```powershell
command-cc usage --json
```

## Dry Runs

`--dry-run` spends no generation tokens. When logged in, it performs model discovery so the shown env slots and `availableModels` match a real launch.

```powershell
command-cc --dry-run --model xiaomi/mimo-v2.5-pro
command-cc --dry-run --model mimo-v2.5-pro
command-cc --dry-run --clean-model-name
```

Use this when `/model` looks wrong before burning credits on an actual prompt.

## How It Works

```text
Claude Code
  reads ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
  sends /v1/models and /v1/messages

command-cc local gateway
  answers /v1/models with Claude Code-compatible aliases
  converts Anthropic Messages requests into Command Code app API requests
  converts Command Code streaming output back into Anthropic-style events

Command Code
  /provider/v1/models       model discovery only
  /alpha/generate           actual generation
  /alpha/billing/*          usage and subscription checks
```

The real Command Code API key stays in the local gateway process. Claude Code receives a local placeholder auth token, not your Command Code key.

For Kiro:

```text
Claude Code
  reads ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
  sends /v1/models and /v1/messages

kiro-cc
  starts the external Kiro Gateway checkout
  passes the generated local PROXY_API_KEY to Claude Code

Kiro Gateway
  reads Kiro CLI auth from the configured SQLite database
  adapts Anthropic-compatible requests to Kiro's model API
```

## Troubleshooting

| Symptom | What to run | Likely fix |
| --- | --- | --- |
| `/model` only shows MiMo, or shows MiMo five times | `command-cc --dry-run` | Restart old Claude Code sessions. New launches should place Go-plan models into clean picker slots. |
| MiniMax, GLM, or another Go model disappears | `command-cc --dry-run` then restart | Make sure the wrapper is current. `Default` carries the selected model, five custom slots carry priority models, and extra models are exposed through gateway discovery / `availableModels`. |
| Only two models show after adding `mimo-v2.5` | `command-cc --dry-run` then restart | Make sure the wrapper is `0.6.17` or newer. Stale gateway model cache is cleared before launch. |
| A duplicate selected model appears as row 7 | `command-cc --dry-run` then restart | Make sure the wrapper is `0.6.17` or newer. It removes stale `~/.claude/settings.json` model values before launch. |
| `claude-*` names show up in the first Go models | `command-cc --dry-run` then restart | Restart old sessions and make sure the wrapper is `0.6.17` or newer. |
| `API error` retry loop or `401 Invalid Authorization` | `command-cc doctor` | If `app API auth` fails, run `command-cc logout`, then `command-cc login`. The provider model list can still work with a stale key while `/alpha/generate` rejects it. |
| `402 upgrade_required` from Provider API | `command-cc doctor` | Generation should use `/alpha/generate`; Provider API is only for model discovery. |
| `MODEL_NOT_IN_PLAN` or plan access error | `command-cc models` | Pick one of the listed models or use `--all-models` to inspect the full catalog. |
| `spawn EINVAL` | `command-cc -- --version` | Verify Claude Code can spawn through the wrapper. Update/restart old sessions. |
| Command Code CLI not found | `npm i -g command-code@latest` | The wrapper falls back to `npx`, but global install is cleaner. |
| Wrong auth/account | `command-cc whoami` | Check the official Command Code account currently logged in. |
| GUI asks you to log in before showing Code | Sign in to Claude Desktop | This is the GUI app's own Claude/Anthropic OAuth login. `command-cc` cannot bypass it. |
| GUI says your account is on the Free plan | Use terminal `command-cc`, or use a Claude account with Code access | Claude Code Desktop blocks Free-plan accounts before gateway routing can start. |
| GUI session ignores the gateway | `command-cc gui status` | Use a Local session, restart the GUI after setup, and keep `command-cc gui` or `command-cc gui serve` running. |
| Remote Control fails before showing a URL | `claude doctor`, then `command-cc remote --dry-run` | Remote Control eligibility/OAuth is checked by Anthropic before model routing starts. |
| `kiro-cc setup` cannot create venv | `kiro-cc doctor` | Install Python 3.10+ and git, then rerun `kiro-cc setup`. |
| `kiro-cc models` fails | `kiro-cc login` | Kiro CLI is missing, not logged in, or the Kiro CLI database is unavailable. |
| Kiro Gateway starts but Claude Code gets 401 | `kiro-cc setup` | Regenerate the gateway `.env`/proxy key, then relaunch `kiro-cc`. |
| Kiro model is not visible in `/model` | `kiro-cc --model <id>` | Claude Code custom picker rows are limited; direct model launch is the reliable path. |

## Development

Useful checks:

```powershell
node --check .\bin\command-claudecode.mjs
command-cc --version
command-cc doctor
command-cc models
command-cc models --json
command-cc gui --dry-run
command-cc gui status
command-cc remote --dry-run
command-cc -- --version
kiro-cc doctor
kiro-cc models
kiro-cc --dry-run --model auto
npm pack --dry-run
```

Start only the local gateway:

```powershell
command-cc serve --port 48146
```

Inspect models from that gateway:

```powershell
Invoke-RestMethod http://127.0.0.1:48146/v1/models
```

## Notes

- Node.js 20 or newer is required.
- `kiro-cc` additionally needs Python 3.10+ and git to install/update the external Kiro Gateway checkout.
- The wrapper is intentionally local-first: no background daemon is installed.
- Claude Code is required separately. This package does not ship Claude Code or any modified Claude Code files.
- Kiro and Kiro Gateway are required separately for `kiro-cc`; this package does not ship Kiro or vendored Kiro Gateway source.
- Image inputs are currently represented as text placeholders when adapting to Command Code's app API.
- The package is distributed without an open-source license unless a license file is added later.
- The repository is packaged with only `bin/`, `assets/`, `README.md`, and `package.json`.
