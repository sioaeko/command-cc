#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { arch, homedir, platform } from 'node:os';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

const VERSION = '0.7.0';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_GUI_PORT = 64726;
const DEFAULT_API_BASE = 'https://api.commandcode.ai';
const DEFAULT_PROVIDER_BASE = 'https://api.commandcode.ai/provider';
const GATEWAY_MODEL_PREFIX = 'claude-';
const LEGACY_GATEWAY_MODEL_PREFIXES = [
  'anthropic-command-code-',
  'claude-command-code-',
  'claude-cc-'
];
const CONFIG_PATH = join(homedir(), '.command-claudecode', 'config.json');
const CLAUDE_CODE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CLAUDE_CODE_BACKUP_DIR = join(homedir(), '.claude', 'backups');
const CLAUDE_CODE_GATEWAY_MODELS_CACHE_PATH = join(homedir(), '.claude', 'cache', 'gateway-models.json');
const COMMAND_CODE_CLI_VERSION = '0.37.2';
const GO_PLAN_MODEL_IDS = new Set([
  'deepseek/deepseek-v4-pro',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'Qwen/Qwen3.7-Max',
  'MiniMaxAI/MiniMax-M3',
  'xiaomi/mimo-v2.5-pro',
  'xiaomi/mimo-v2.5'
]);
const GO_PLAN_SLOT_PRIORITY = [
  'deepseek/deepseek-v4-pro',
  'MiniMaxAI/MiniMax-M3',
  'Qwen/Qwen3.7-Max',
  'xiaomi/mimo-v2.5',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'xiaomi/mimo-v2.5-pro',
];
const BOOLEAN_CONFIG_FIELDS = new Set([
  'restrictModelPicker',
  'filterModelsByPlan',
  'cleanModelName'
]);
const CLAUDE_MODEL_SLOT_KEYS = [
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION'
];
const COMMAND_CC_CLAUDE_ENV_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  ...CLAUDE_MODEL_SLOT_KEYS
]);

const HELP = `
command-cc ${VERSION}

Launch Claude Code with its model calls routed through Command Code.

Usage:
  command-cc [options] [-- <claude args...>]
  command-cc login
  command-cc logout
  command-cc status
  command-cc whoami
  command-cc setup [options]
  command-cc config <get|set|unset|path> ...
  command-cc serve [options]
  command-cc gui [options]
  command-cc gui <setup|serve|status|uninstall> [options]
  command-cc models [options] [--json]
  command-cc usage [--json]
  command-cc doctor [options]
  command-cc env [--shell powershell|cmd|bash]

Options:
  --model <id>          Initial Command Code model id. If omitted, the first provider model is used.
  --port <number>       Local gateway port. Defaults to a random free port.
  --host <host>         Local gateway host. Default: 127.0.0.1.
  --api-key <key>       Command Code API key. Prefer COMMAND_CODE_API_KEY.
  --api-key-env <name>  Read the API key from another environment variable.
  --provider-base <url> Command Code model discovery base. Default: https://api.commandcode.ai/provider.
  --claude <path>       Claude Code executable. Default: auto-detect "claude".
  --all-models          Do not filter the picker by the detected Command Code plan.
  --plan-filter         Force plan-aware model filtering, even if config disables it.
  --clean-model-name    Deepclaude-style single-model mode with no claude-* picker aliases.
  --multi-model-picker  Force the default multi-model picker, even if config enables clean mode.
  --allow-claude-model-list
                       Do not restrict Claude Code's /model picker to Command Code models.
  --dry-run             Print the launch command and env without starting Claude Code.
  -h, --help            Show this help.
  -v, --version         Show wrapper version.

Examples:
  command-cc login
  command-cc setup
  command-cc
  command-cc gui
  command-cc --model gpt-5.5 -- -p "explain this repo"
  command-cc models
  command-cc usage

Notes:
  User config is stored at ${CONFIG_PATH}.
  Command Code login is stored at ~/.commandcode/auth.json and reused automatically.
  Run "command-cc models" after login/setup to verify available ids.
  The /model picker uses gateway aliases that decode back to the real Command Code model ids.
  Command Code models are adapted locally from Anthropic Messages to Command Code's app API.
`.trim();

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const argv = process.argv.slice(2);
  const first = argv[0];

  if (!first || first === 'launch') {
    const args = first === 'launch' ? argv.slice(1) : argv;
    await launchClaude(parseOptions(args));
    return;
  }

  if (first === '-h' || first === '--help' || first === 'help') {
    console.log(HELP);
    return;
  }

  if (first === '-v' || first === '--version' || first === 'version') {
    console.log(VERSION);
    return;
  }

  if (first === 'login') {
    const loginArgs = ['login', ...argv.slice(1)];
    const code = await runCommandCodeCli(loginArgs);
    if (code === 0 && !hasHelpFlag(loginArgs)) {
      console.log('');
      await printCommandCodeAuthHint();
    }
    return;
  }

  if (first === 'logout') {
    await runCommandCodeCli(['logout', ...argv.slice(1)]);
    return;
  }

  if (first === 'status') {
    await runCommandCodeCli(['status', ...argv.slice(1)]);
    return;
  }

  if (first === 'whoami') {
    await runCommandCodeCli(['whoami', ...argv.slice(1)]);
    return;
  }

  if (first === 'command-code') {
    await runCommandCodeCli(argv.slice(1));
    return;
  }

  if (first === 'auth') {
    await runCommandCodeCli(argv.slice(1));
    return;
  }

  if (first === 'setup') {
    await setupConfig(parseOptions(argv.slice(1)));
    return;
  }

  if (first === 'config') {
    await manageConfig(argv.slice(1));
    return;
  }

  if (first === 'serve') {
    await serveOnly(parseOptions(argv.slice(1)));
    return;
  }

  if (first === 'gui' || first === 'desktop') {
    await guiCommand(argv.slice(1));
    return;
  }

  if (first === 'models') {
    await listModels(parseOptions(argv.slice(1)));
    return;
  }

  if (first === 'usage') {
    await printUsage(parseOptions(argv.slice(1)));
    return;
  }

  if (first === 'doctor') {
    await doctor(parseOptions(argv.slice(1)));
    return;
  }

  if (first === 'env') {
    await printEnv(parseOptions(argv.slice(1)));
    return;
  }

  await launchClaude(parseOptions(argv));
}

function parseOptions(args) {
  const options = {
    host: DEFAULT_HOST,
    port: 0,
    providerBase: DEFAULT_PROVIDER_BASE,
    providerBaseExplicit: false,
    model: undefined,
    apiKey: undefined,
    apiKeyEnv: 'COMMAND_CODE_API_KEY',
    claude: undefined,
    dryRun: false,
    shell: process.platform === 'win32' ? 'powershell' : 'bash',
    restrictModelPicker: true,
    restrictModelPickerExplicit: false,
    filterModelsByPlan: true,
    filterModelsByPlanExplicit: false,
    cleanModelName: false,
    cleanModelNameExplicit: false,
    json: false,
    claudeArgs: []
  };

  let passthrough = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (passthrough) {
      options.claudeArgs.push(arg);
      continue;
    }

    if (arg === '--') {
      passthrough = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--allow-claude-model-list' || arg === '--no-restrict-model-picker') {
      options.restrictModelPicker = false;
      options.restrictModelPickerExplicit = true;
      continue;
    }

    if (arg === '--all-models' || arg === '--no-plan-filter') {
      options.filterModelsByPlan = false;
      options.filterModelsByPlanExplicit = true;
      continue;
    }

    if (arg === '--plan-filter') {
      options.filterModelsByPlan = true;
      options.filterModelsByPlanExplicit = true;
      continue;
    }

    if (arg === '--clean-model-name' || arg === '--single-model') {
      options.cleanModelName = true;
      options.cleanModelNameExplicit = true;
      continue;
    }

    if (arg === '--multi-model-picker' || arg === '--no-clean-model-name') {
      options.cleanModelName = false;
      options.cleanModelNameExplicit = true;
      continue;
    }

    if (arg === '--restrict-model-picker') {
      options.restrictModelPicker = true;
      options.restrictModelPickerExplicit = true;
      continue;
    }

    if (arg === '--model' || arg === '-m') {
      options.model = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--port') {
      options.port = Number.parseInt(requireValue(args, index, arg), 10);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error('--port must be between 0 and 65535.');
      }
      index += 1;
      continue;
    }

    if (arg === '--host') {
      options.host = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--api-key') {
      options.apiKey = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--api-key-env') {
      options.apiKeyEnv = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--provider-base') {
      options.providerBase = requireValue(args, index, arg).replace(/\/+$/, '');
      options.providerBaseExplicit = true;
      index += 1;
      continue;
    }

    if (arg === '--claude') {
      options.claude = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--shell') {
      options.shell = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}. Put Claude Code arguments after --.`);
  }

  return options;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

async function setupConfig(options) {
  const existing = await readUserConfig();
  const commandCodeAuth = await readCommandCodeAuth();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    if (!options.apiKey && !existing.apiKey && !commandCodeAuth?.apiKey) {
      console.log('No Command Code login found. Run "command-cc login" first, or paste an API key here.');
      console.log('');
    }

    const apiKey = options.apiKey
      || await askForValue(
        rl,
        `Command Code API key${commandCodeAuth?.apiKey ? ' [use Command Code login]' : existing.apiKey ? ' [keep existing]' : ' (optional if logged in)'}`,
        existing.apiKey || ''
      );
    const providerBaseDefault = options.providerBaseExplicit
      ? options.providerBase
      : existing.providerBase || DEFAULT_PROVIDER_BASE;
    const providerBase = await askForValue(rl, 'Provider base URL', providerBaseDefault);
    const modelDefault = options.model || existing.model || '';
    const model = await askForValue(rl, 'Default model id (optional)', modelDefault);
    const claudeDefault = options.claude || existing.claude || '';
    const claude = await askForValue(rl, 'Claude executable path/name (optional)', claudeDefault);
    const restrictDefault = options.restrictModelPickerExplicit
      ? options.restrictModelPicker
      : existing.restrictModelPicker !== false;
    const restrictAnswer = await askForValue(
      rl,
      'Restrict /model picker to Command Code models? (Y/n)',
      restrictDefault ? 'Y' : 'n'
    );

    const config = {
      ...existing,
      apiKey,
      providerBase: providerBase.replace(/\/+$/, ''),
      restrictModelPicker: !/^n(o)?$/i.test(restrictAnswer.trim())
    };

    if (apiKey.trim()) {
      config.apiKey = apiKey.trim();
    }

    if (model.trim()) {
      config.model = model.trim();
    }

    if (claude.trim()) {
      config.claude = claude.trim();
    }

    await writeUserConfig(config);

    console.log(`Saved config to ${CONFIG_PATH}`);
    console.log(`API key: ${config.apiKey ? maskSecret(config.apiKey) : commandCodeAuth?.apiKey ? `from Command Code login (${maskSecret(commandCodeAuth.apiKey)})` : '(not saved)'}`);
    console.log(`Provider: ${config.providerBase}`);
    console.log(`Default model: ${config.model || '(first non-Claude Command Code model)'}`);
    console.log(`Restrict picker: ${config.restrictModelPicker ? 'yes' : 'no'}`);
  } finally {
    rl.close();
  }
}

async function manageConfig(args) {
  const command = args[0] || 'get';

  if (command === 'path') {
    console.log(CONFIG_PATH);
    return;
  }

  if (command === 'get' || command === 'show') {
    const showSecrets = args.includes('--show-secrets');
    const config = await readUserConfig();
    console.log(JSON.stringify(redactConfig(config, showSecrets), null, 2));
    return;
  }

  if (command === 'set') {
    const key = args[1];
    const value = args.slice(2).join(' ');
    if (!key || !value) {
      throw new Error('Usage: command-cc config set <api-key|model|provider-base|claude|restrict-model-picker|filter-models-by-plan|clean-model-name> <value>');
    }

    const config = await readUserConfig();
    setConfigValue(config, key, value);
    await writeUserConfig(config);
    console.log(`Updated ${key} in ${CONFIG_PATH}`);
    return;
  }

  if (command === 'unset' || command === 'delete') {
    const key = args[1];
    if (!key) {
      throw new Error('Usage: command-cc config unset <api-key|model|provider-base|claude|restrict-model-picker|filter-models-by-plan|clean-model-name>');
    }

    const config = await readUserConfig();
    unsetConfigValue(config, key);
    await writeUserConfig(config);
    console.log(`Removed ${key} from ${CONFIG_PATH}`);
    return;
  }

  throw new Error('Usage: command-cc config <get|set|unset|path> ...');
}

async function runCommandCodeCli(args) {
  const resolved = await resolveCommandCodeCli();

  if (resolved.usesNpx) {
    console.error('command-cc: Command Code CLI not found on PATH, using npx -y -p command-code@latest cmdc');
  }

  return spawnAndForward(resolved.command, [...resolved.prefixArgs, ...args], {
    env: process.env
  });
}

async function resolveCommandCodeCli() {
  const candidates = process.platform === 'win32'
    ? ['cmdc', 'command-code', 'commandcode']
    : ['cmd', 'cmdc', 'command-code', 'commandcode'];

  for (const candidate of candidates) {
    const command = await findExecutable(candidate);
    if (command) {
      return {
        command,
        prefixArgs: [],
        usesNpx: false
      };
    }
  }

  const npx = await findExecutable('npx');
  if (npx) {
    if (process.platform === 'win32') {
      return {
        command: process.env.ComSpec || 'cmd.exe',
        prefixArgs: ['/d', '/s', '/c', 'npx', '-y', '-p', 'command-code@latest', 'cmdc'],
        usesNpx: true
      };
    }

    return {
      command: npx,
      prefixArgs: ['-y', '-p', 'command-code@latest', 'cmdc'],
      usesNpx: true
    };
  }

  throw new Error('Could not find Command Code CLI or npx. Install it with: npm i -g command-code@latest');
}

function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h') || args.includes('help');
}

async function printCommandCodeAuthHint() {
  const auth = await readCommandCodeAuth();

  if (!auth?.apiKey) {
    console.log(`No Command Code auth file found at ${commandCodeAuthPath()}.`);
    console.log('If the login window is still open, finish login and then run: command-cc status');
    return;
  }

  console.log(`Command Code login detected: ${auth.authPath}`);
  console.log(`API key: ${maskSecret(auth.apiKey)}`);
  console.log('command-cc will reuse this login automatically.');
}

async function askForValue(rl, label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue;
}

function setConfigValue(config, key, value) {
  const field = configFieldName(key);

  if (BOOLEAN_CONFIG_FIELDS.has(field)) {
    config[field] = parseBooleanConfigValue(value, field);
    return;
  }

  config[field] = value.trim();
}

function unsetConfigValue(config, key) {
  delete config[configFieldName(key)];
}

function configFieldName(key) {
  const normalized = key.toLowerCase();
  const map = {
    'api-key': 'apiKey',
    apikey: 'apiKey',
    key: 'apiKey',
    model: 'model',
    'provider-base': 'providerBase',
    provider: 'providerBase',
    claude: 'claude',
    'restrict-model-picker': 'restrictModelPicker',
    restrict: 'restrictModelPicker',
    'filter-models-by-plan': 'filterModelsByPlan',
    'plan-filter': 'filterModelsByPlan',
    'clean-model-name': 'cleanModelName',
    clean: 'cleanModelName'
  };

  const field = map[normalized];
  if (!field) {
    throw new Error(`Unknown config key: ${key}`);
  }

  return field;
}

function parseBooleanConfigValue(value, key) {
  const normalized = value.trim().toLowerCase();
  if (/^(true|1|yes|y|on)$/i.test(normalized)) {
    return true;
  }

  if (/^(false|0|no|n|off)$/i.test(normalized)) {
    return false;
  }

  throw new Error(`${key} must be true or false.`);
}

function redactConfig(config, showSecrets) {
  return {
    ...config,
    ...(config.apiKey && !showSecrets ? { apiKey: maskSecret(config.apiKey) } : {})
  };
}

function maskSecret(value) {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return number.toLocaleString('en-US', {
    maximumFractionDigits: 6
  });
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }

  return Math.round(number).toLocaleString('en-US');
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return String(value).split('T')[0];
}

async function launchClaude(options) {
  options = await withUserConfig(options);
  const apiKeyInfo = await resolveApiKeyInfo(options);
  const apiKey = apiKeyInfo.apiKey;
  const claudeCommand = options.claude || await findExecutable('claude') || 'claude';

  if (options.dryRun) {
    const selection = await resolveDryRunModelSelection(options, apiKey);
    const selectedModel = selection.selectedModel;
    const claudeArgs = buildClaudeArgs(options.claudeArgs, selection.modelAliases, options);
    const port = options.port || 44003;
    const env = buildClaudeEnv(`http://${options.host}:${port}`, selectedModel, selection.modelAliasMap, options, selection.slotModelIds);
    console.log(formatCommand(claudeCommand, claudeArgs));
    printEnvSummary(env, options);
    return;
  }

  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc setup", set COMMAND_CODE_API_KEY, or pass --api-key.');
  }

  const {
    account,
    pickerModelIds,
    selectedModel,
    modelAliasMap,
    modelAliases,
    slotModelIds,
    discoveryModelIds,
    discoveryModelAliases,
    wrapperModelIds
  } = await resolveLaunchModelSelection(options, apiKey);
  const claudeArgs = buildClaudeArgs(options.claudeArgs, modelAliases, options);

  if (!options.claude && !await findExecutable('claude')) {
    throw new Error('Could not find Claude Code on PATH. Install Claude Code or pass --claude <path>.');
  }

  const gateway = await startGateway({
    host: options.host,
    port: options.port,
    providerBase: options.providerBase,
    apiBase: commandCodeApiBaseFromProviderBase(options.providerBase),
    allowedModelIds: discoveryModelIds,
    modelAliasMap,
    cleanModelName: options.cleanModelName,
    apiKey
  });

  const baseUrl = `http://${gateway.host}:${gateway.port}`;
  const env = {
    ...process.env,
    ...buildClaudeEnv(baseUrl, selectedModel, modelAliasMap, options, slotModelIds)
  };

  console.error(`command-cc: routing Claude Code through ${baseUrl}`);
  console.error(`command-cc: requested model ${selectedModel}`);
  console.error(`command-cc: auth source ${apiKeyInfo.source}`);
  if (account?.planId) {
    console.error(`command-cc: detected plan ${account.planId}`);
  }
  console.error(`command-cc: generation API ${commandCodeApiBaseFromProviderBase(options.providerBase)}/alpha/generate`);
  if (isGoPlan(account?.planId) && options.filterModelsByPlan) {
    console.error(`command-cc: /model picker filtered to ${pickerModelIds.length} Go-plan models`);
  }
  if (options.cleanModelName) {
    console.error('command-cc: clean model name mode uses one visible model; use default mode for the multi-model /model picker');
  }
  if (options.restrictModelPicker) {
    console.error(`command-cc: /model picker restricted to ${modelAliases.length} Command Code models`);
  }

  try {
    await clearStaleClaudeCodeSavedModel(wrapperModelIds, modelAliasMap);
    await clearClaudeCodeGatewayModelCache();
    await spawnAndForward(claudeCommand, claudeArgs, { env });
  } finally {
    await gateway.close();
  }
}

async function serveOnly(options) {
  options = await withUserConfig(options);
  const apiKey = await resolveApiKey(options);
  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc setup", set COMMAND_CODE_API_KEY, or pass --api-key.');
  }

  const {
    discoveryModelIds,
    modelAliasMap
  } = await resolveLaunchModelSelection(options, apiKey);

  const gateway = await startGateway({
    host: options.host,
    port: options.port,
    providerBase: options.providerBase,
    apiBase: commandCodeApiBaseFromProviderBase(options.providerBase),
    allowedModelIds: discoveryModelIds,
    modelAliasMap,
    cleanModelName: options.cleanModelName,
    apiKey
  });

  console.log(`Command Code Claude gateway listening at http://${gateway.host}:${gateway.port}`);
  console.log('Set ANTHROPIC_BASE_URL to that URL when launching Claude Code.');
}

async function guiCommand(args) {
  const first = args[0];
  const action = first && !first.startsWith('-') ? first : 'start';
  const optionArgs = action === first ? args.slice(1) : args;
  const options = parseOptions(optionArgs);

  if (action === 'start' || action === 'run') {
    const context = await resolveGuiGatewayContext(options);
    if (options.dryRun) {
      printGuiDryRun(context, 'start');
      return;
    }

    const result = await writeClaudeCodeSettingsEnv(context.env, context.selection);
    printGuiSettingsResult(context, result);
    await clearClaudeCodeGatewayModelCache();
    await startGuiGateway(context);
    return;
  }

  if (action === 'setup' || action === 'install') {
    const context = await resolveGuiGatewayContext(options);
    if (options.dryRun) {
      printGuiDryRun(context, 'setup');
      return;
    }

    const result = await writeClaudeCodeSettingsEnv(context.env, context.selection);
    printGuiSettingsResult(context, result);
    await clearClaudeCodeGatewayModelCache();
    console.log('');
    console.log(`Start the GUI gateway with: command-cc gui serve --port ${context.options.port}`);
    console.log('Then open Claude Desktop / Claude Code GUI and start a Local session.');
    return;
  }

  if (action === 'serve') {
    const context = await resolveGuiGatewayContext(options);
    if (options.dryRun) {
      printGuiDryRun(context, 'serve');
      return;
    }

    await startGuiGateway(context);
    return;
  }

  if (action === 'status') {
    await printGuiStatus();
    return;
  }

  if (action === 'uninstall' || action === 'remove' || action === 'unset') {
    await uninstallGuiSettings(options);
    return;
  }

  throw new Error(`Unknown gui action: ${action}. Use setup, serve, status, uninstall, or run command-cc gui.`);
}

async function resolveGuiGatewayContext(options) {
  options = await withUserConfig(options);
  if (!options.port) {
    options.port = DEFAULT_GUI_PORT;
  }

  const apiKeyInfo = await resolveApiKeyInfo(options);
  const apiKey = apiKeyInfo.apiKey;
  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc login" first, then run "command-cc gui".');
  }

  const selection = await resolveLaunchModelSelection(options, apiKey);
  const baseUrl = `http://${options.host}:${options.port}`;
  const env = buildClaudeEnv(
    baseUrl,
    selection.selectedModel,
    selection.modelAliasMap,
    options,
    selection.slotModelIds
  );

  return {
    options,
    apiKey,
    apiKeyInfo,
    selection,
    baseUrl,
    env
  };
}

async function startGuiGateway(context) {
  const gateway = await startGateway({
    host: context.options.host,
    port: context.options.port,
    providerBase: context.options.providerBase,
    apiBase: commandCodeApiBaseFromProviderBase(context.options.providerBase),
    allowedModelIds: context.selection.discoveryModelIds,
    modelAliasMap: context.selection.modelAliasMap,
    cleanModelName: context.options.cleanModelName,
    apiKey: context.apiKey
  });

  console.log(`Command Code GUI gateway listening at http://${gateway.host}:${gateway.port}`);
  console.log(`Claude settings env: ${CLAUDE_CODE_SETTINGS_PATH}`);
  console.log(`Model: ${toCleanModelAlias(context.selection.selectedModel, context.selection.modelAliasMap)}`);
  console.log('Leave this command running, then open Claude Desktop / Claude Code GUI and start a Local session.');
  console.log('Cloud or remote sessions cannot reach this local 127.0.0.1 gateway.');
}

function printGuiDryRun(context, action) {
  console.log(`command-cc gui ${action} dry run`);
  console.log(`settings: ${CLAUDE_CODE_SETTINGS_PATH}`);
  console.log(`gateway: ${context.baseUrl}`);
  console.log(`auth source: ${context.apiKeyInfo.source}`);
  console.log('');
  console.log(JSON.stringify({ env: context.env }, null, 2));
}

function printGuiSettingsResult(context, result) {
  console.log(`Wrote Claude Code GUI env to ${CLAUDE_CODE_SETTINGS_PATH}`);
  if (result.backupPath) {
    console.log(`Backup: ${result.backupPath}`);
  }
  if (result.removedModel) {
    console.log(`Removed stale saved model: ${result.removedModel}`);
  }
  console.log(`Gateway URL: ${context.baseUrl}`);
  console.log(`Visible models: ${context.selection.modelAliases.join(', ')}`);
}

async function writeClaudeCodeSettingsEnv(env, selection) {
  const { raw, settings } = await readClaudeCodeSettingsObject();
  let backupPath;
  if (raw !== undefined) {
    backupPath = await backupClaudeCodeSettings(raw, 'settings-before-command-cc-gui');
  }

  const existingEnv = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
    ? settings.env
    : {};
  settings.env = {
    ...existingEnv,
    ...env
  };

  let removedModel;
  if (typeof settings.model === 'string' && isWrapperSavedModel(settings.model, selection.wrapperModelIds, selection.modelAliasMap)) {
    removedModel = settings.model;
    delete settings.model;
  }

  await mkdir(dirname(CLAUDE_CODE_SETTINGS_PATH), { recursive: true });
  await writeFile(CLAUDE_CODE_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { backupPath, removedModel };
}

async function uninstallGuiSettings(options) {
  const { raw, settings } = await readClaudeCodeSettingsObject();
  if (raw === undefined) {
    console.log(`No Claude Code settings file found at ${CLAUDE_CODE_SETTINGS_PATH}`);
    return;
  }

  const env = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
    ? settings.env
    : undefined;
  const removed = [];

  if (env) {
    for (const key of COMMAND_CC_CLAUDE_ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        delete env[key];
        removed.push(key);
      }
    }

    if (Object.keys(env).length === 0) {
      delete settings.env;
    }
  }

  if (options.dryRun) {
    console.log(`Would remove ${removed.length} command-cc env keys from ${CLAUDE_CODE_SETTINGS_PATH}`);
    for (const key of removed) {
      console.log(`  ${key}`);
    }
    return;
  }

  const backupPath = await backupClaudeCodeSettings(raw, 'settings-before-command-cc-gui-uninstall');
  await writeFile(CLAUDE_CODE_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  console.log(`Removed ${removed.length} command-cc env keys from ${CLAUDE_CODE_SETTINGS_PATH}`);
  console.log(`Backup: ${backupPath}`);
}

async function printGuiStatus() {
  const { settings } = await readClaudeCodeSettingsObject();
  const env = settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
    ? settings.env
    : {};
  const configuredKeys = [...COMMAND_CC_CLAUDE_ENV_KEYS].filter((key) => Object.prototype.hasOwnProperty.call(env, key));
  const baseUrl = env.ANTHROPIC_BASE_URL || '';

  console.log(`settings: ${CLAUDE_CODE_SETTINGS_PATH}`);
  console.log(`configured: ${configuredKeys.length ? 'yes' : 'no'}`);
  console.log(`gateway: ${baseUrl || '(not set)'}`);
  console.log(`model: ${env.ANTHROPIC_MODEL || '(not set)'}`);
  console.log(`managed keys: ${configuredKeys.length}`);

  if (baseUrl) {
    const probe = await probeGatewayHealth(baseUrl);
    console.log(`gateway health: ${probe.ok ? 'ok' : `not reachable (${probe.message})`}`);
  }
}

async function readClaudeCodeSettingsObject() {
  let raw;
  try {
    raw = await readFile(CLAUDE_CODE_SETTINGS_PATH, 'utf8');
  } catch {
    return { raw: undefined, settings: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      raw,
      settings: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    };
  } catch {
    const backupPath = await backupClaudeCodeSettings(raw, 'settings-invalid-before-command-cc-gui');
    console.error(`command-cc: existing Claude Code settings JSON was invalid; backed it up to ${backupPath}`);
    return { raw: undefined, settings: {} };
  }
}

async function backupClaudeCodeSettings(raw, prefix) {
  await mkdir(CLAUDE_CODE_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(CLAUDE_CODE_BACKUP_DIR, `${prefix}-${stamp}.json`);
  await writeFile(backupPath, raw, 'utf8');
  return backupPath;
}

async function probeGatewayHealth(baseUrl) {
  try {
    const response = await fetch(new URL('/health', baseUrl));
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }
    return { ok: true, message: 'ok' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function listModels(options) {
  options = await withUserConfig(options);
  const apiKey = await resolveApiKey(options);
  const account = await fetchAccountSummary(commandCodeApiBaseFromProviderBase(options.providerBase), apiKey);
  const models = await fetchModels(options.providerBase, apiKey);
  const allowedIds = filterModelIdsForPlan(modelIdsFromPayload(models), account, options);
  const allowedSet = new Set(allowedIds);
  const data = (Array.isArray(models.data) ? models.data : [])
    .filter((model) => allowedSet.has(getModelId(model)));

  const rows = data
    .map((model) => getModelId(model))
    .filter(Boolean)
    .map((id) => ({
      id,
      route: 'alpha-generate',
      pickerId: toCleanModelAlias(id),
      gatewayId: toPickerModelAlias(id, undefined, options),
      cleanId: toCleanModelAlias(id),
      displayName: shortModelName(id)
    }));

  if (options.json) {
    console.log(JSON.stringify({
      count: rows.length,
      planId: account?.planId || '',
      planFiltered: Boolean(isGoPlan(account?.planId) && options.filterModelsByPlan),
      models: rows
    }, null, 2));
    return;
  }

  if (isGoPlan(account?.planId) && options.filterModelsByPlan) {
    console.error(`command-cc: showing ${data.length} Go-plan models for ${account.planId}`);
  }

  for (const row of rows) {
    console.log(`${row.id}\t${row.route}\t${row.pickerId}`);
  }
}

async function doctor(options) {
  options = await withUserConfig(options);
  const apiKeyInfo = await resolveApiKeyInfo(options);
  const apiKey = apiKeyInfo.apiKey;
  const claudePath = options.claude || await findExecutable('claude');
  let selectedModel = resolveSelectedModel(options);

  console.log(`command-cc: ${VERSION}`);
  console.log(`node: ${process.version}`);
  console.log(`claude: ${claudePath || 'not found'}`);
  console.log(`provider: ${options.providerBase}`);
  console.log(`generation: ${commandCodeApiBaseFromProviderBase(options.providerBase)}/alpha/generate`);
  console.log(`api key: ${apiKey ? `found (${apiKeyInfo.source})` : 'missing'}`);

  if (!apiKey) {
    console.log('Run "command-cc setup" or set COMMAND_CODE_API_KEY before launching Claude Code through this wrapper.');
    return;
  }

  try {
    const models = await fetchModels(options.providerBase, apiKey);
    const account = await fetchAccountSummary(commandCodeApiBaseFromProviderBase(options.providerBase), apiKey);
    const modelIds = modelIdsFromPayload(models);
    const filteredModelIds = filterModelIdsForPlan(modelIds, account, options);
    const count = Array.isArray(models.data) ? models.data.length : 0;
    console.log(`models endpoint: ok (${count} models)`);
    if (account?.userName) {
      console.log(`account: ${account.userName}`);
    }
    if (account?.planId) {
      console.log(`plan: ${account.planId}`);
    }
    if (isGoPlan(account?.planId) && options.filterModelsByPlan) {
      console.log(`plan filter: ${filteredModelIds.length} Go-plan models`);
    }
    selectedModel = resolveKnownModelId(selectedModel, modelIds) || selectedModel || pickInitialProviderModel(filteredModelIds);
    console.log(`initial model: ${selectedModel || 'missing'}`);
    if (selectedModel) {
      console.log(`visible id: ${toCleanModelAlias(selectedModel)}`);
      console.log(`gateway id: ${toPickerModelAlias(selectedModel, undefined, options)}`);
    }
  } catch (error) {
    console.log(`models endpoint: failed (${error.message})`);
  }
}

async function printUsage(options) {
  options = await withUserConfig(options);
  const apiKeyInfo = await resolveApiKeyInfo(options);
  const apiKey = apiKeyInfo.apiKey;

  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc login" first.');
  }

  const apiBase = commandCodeApiBaseFromProviderBase(options.providerBase);
  const [accountResult, creditsResult, usageResult] = await Promise.allSettled([
    fetchAccountSummary(apiBase, apiKey),
    fetchCommandCodeJson(apiBase, apiKey, '/alpha/billing/credits'),
    fetchCommandCodeJson(apiBase, apiKey, '/alpha/usage/summary')
  ]);

  const account = accountResult.status === 'fulfilled' ? accountResult.value : {};
  const credits = creditsResult.status === 'fulfilled' ? creditsResult.value?.credits || creditsResult.value : {};
  const usage = usageResult.status === 'fulfilled' ? usageResult.value : {};

  if (options.json) {
    console.log(JSON.stringify({ account, credits, usage }, null, 2));
    return;
  }

  console.log('Command Code usage');
  if (account.userName) {
    console.log(`account: ${account.userName}`);
  }
  if (account.planId) {
    console.log(`plan: ${account.planId}${account.subscriptionStatus ? ` (${account.subscriptionStatus})` : ''}`);
  }
  if (account.currentPeriodStart || account.currentPeriodEnd) {
    console.log(`period: ${formatDate(account.currentPeriodStart)} -> ${formatDate(account.currentPeriodEnd)}`);
  }
  if (Object.keys(credits).length > 0) {
    console.log(`credits: monthly ${formatNumber(credits.monthlyCredits)}, purchased ${formatNumber(credits.purchasedCredits)}, free ${formatNumber(credits.freeCredits)}`);
  }
  if (Object.keys(usage).length > 0) {
    console.log(`usage: ${formatNumber(usage.totalCredits ?? usage.totalCost)} credits, ${formatInteger(usage.totalTokens)} tokens (${formatInteger(usage.totalTokensIn)} in / ${formatInteger(usage.totalTokensOut)} out), ${formatInteger(usage.totalCount)} requests, ${formatNumber(usage.successRate)}% success`);
  }

  if (Array.isArray(usage.models) && usage.models.length > 0) {
    console.log('models:');
    for (const model of usage.models) {
      console.log(`  ${model.model}\t${formatInteger(model.count)} req\t${formatNumber(model.totalCost)} credits`);
    }
  }
}

async function printEnv(options) {
  options = await withUserConfig(options);
  const baseUrl = `http://${options.host}:${options.port || '<port>'}`;
  const env = buildClaudeEnv(baseUrl, resolveSelectedModel(options) || '<COMMAND_CODE_MODEL>', undefined, options);

  if (options.shell === 'cmd') {
    for (const [key, value] of Object.entries(env)) {
      console.log(`set ${key}=${value}`);
    }
    return;
  }

  if (options.shell === 'bash') {
    for (const [key, value] of Object.entries(env)) {
      console.log(`export ${key}=${shellQuote(value)}`);
    }
    return;
  }

  for (const [key, value] of Object.entries(env)) {
    console.log(`$env:${key} = ${JSON.stringify(value)}`);
  }
}

function buildClaudeEnv(baseUrl, selectedModel, modelAliasMap, options = {}, slotModelIds = []) {
  const selectedAlias = selectedModel.startsWith('<')
    ? selectedModel
    : toCleanModelAlias(selectedModel, modelAliasMap);
  const slotAliases = Array.isArray(slotModelIds) && slotModelIds.length > 0
    ? slotModelIds.map((id) => toCleanModelAlias(id, modelAliasMap))
    : [selectedAlias];
  const env = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: 'command-code-local-gateway',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    ANTHROPIC_MODEL: selectedAlias,
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: displayModelNameForAlias(slotAliases.at(-1) || selectedAlias, modelAliasMap),
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: 'Custom Command Code model'
  };

  CLAUDE_MODEL_SLOT_KEYS.forEach((key, index) => {
    env[key] = slotAliases[index] || selectedAlias;
  });

  return env;
}

async function withUserConfig(options) {
  const userConfig = await readUserConfig();
  const merged = {
    ...options,
    userConfig
  };

  if (!options.providerBaseExplicit && userConfig.providerBase) {
    merged.providerBase = userConfig.providerBase;
  }

  if (!options.claude && userConfig.claude) {
    merged.claude = userConfig.claude;
  }

  if (!options.restrictModelPickerExplicit && typeof userConfig.restrictModelPicker === 'boolean') {
    merged.restrictModelPicker = userConfig.restrictModelPicker;
  }

  if (!options.filterModelsByPlanExplicit && typeof userConfig.filterModelsByPlan === 'boolean') {
    merged.filterModelsByPlan = userConfig.filterModelsByPlan;
  }

  if (!options.cleanModelNameExplicit && typeof userConfig.cleanModelName === 'boolean') {
    merged.cleanModelName = userConfig.cleanModelName;
  }

  return merged;
}

async function readUserConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUserConfig(config) {
  const clean = Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value !== undefined && value !== '')
  );

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
}

async function clearStaleClaudeCodeSavedModel(wrapperModelIds, modelAliasMap) {
  let raw;
  try {
    raw = await readFile(CLAUDE_CODE_SETTINGS_PATH, 'utf8');
  } catch {
    return;
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    return;
  }

  if (!settings || typeof settings !== 'object' || typeof settings.model !== 'string') {
    return;
  }

  if (!isWrapperSavedModel(settings.model, wrapperModelIds, modelAliasMap)) {
    return;
  }

  const staleModel = settings.model;
  delete settings.model;
  await mkdir(CLAUDE_CODE_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(CLAUDE_CODE_BACKUP_DIR, `settings-before-command-cc-${stamp}.json`);
  await writeFile(backupPath, raw, 'utf8');
  await writeFile(CLAUDE_CODE_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  console.error(`command-cc: removed stale Claude Code saved model ${staleModel}`);
  console.error(`command-cc: backed up previous settings to ${backupPath}`);
}

async function clearClaudeCodeGatewayModelCache() {
  try {
    await unlink(CLAUDE_CODE_GATEWAY_MODELS_CACHE_PATH);
    console.error('command-cc: cleared stale Claude Code gateway model cache');
  } catch {
    // Missing cache is fine; Claude Code will refetch from the live local gateway.
  }
}

function isWrapperSavedModel(modelId, wrapperModelIds, modelAliasMap) {
  if (typeof modelId !== 'string' || looksLikeNativeAnthropicModel(modelId)) {
    return false;
  }

  if (modelAliasMap?.has(modelId) || isGatewayModelAlias(modelId)) {
    return true;
  }

  const resolved = resolveKnownModelId(modelId, wrapperModelIds || []);
  return Boolean(resolved);
}

async function resolveApiKey(options) {
  const info = await resolveApiKeyInfo(options);
  return info.apiKey;
}

async function resolveApiKeyInfo(options) {
  if (options.apiKey) {
    return { apiKey: options.apiKey, source: '--api-key' };
  }

  if (options.apiKeyEnv && process.env[options.apiKeyEnv]) {
    return { apiKey: process.env[options.apiKeyEnv], source: `$${options.apiKeyEnv}` };
  }

  if (process.env.CMD_API_KEY) {
    return { apiKey: process.env.CMD_API_KEY, source: '$CMD_API_KEY' };
  }

  const commandCodeAuth = await readCommandCodeAuth();
  if (commandCodeAuth?.apiKey) {
    return {
      apiKey: commandCodeAuth.apiKey,
      source: `Command Code login (${commandCodeAuth.authPath})`
    };
  }

  if (options.userConfig?.apiKey) {
    return {
      apiKey: options.userConfig.apiKey,
      source: `wrapper config (${CONFIG_PATH})`
    };
  }

  return { apiKey: undefined, source: 'missing' };
}

function resolveSelectedModel(options) {
  const model = options.model || process.env.COMMAND_CODE_MODEL || options.userConfig?.model;
  return fromGatewayModelAlias(model);
}

async function resolveFirstProviderModel(providerBase, apiKey) {
  const models = await fetchModels(providerBase, apiKey);
  const id = firstModelId(models);

  if (!id) {
    throw new Error('Command Code returned no models from /provider/v1/models.');
  }

  return id;
}

async function resolveDryRunModelSelection(options, apiKey) {
  if (!apiKey) {
    const selectedModel = resolveSelectedModel(options) || '<first-model-from-command-code>';
    return {
      selectedModel,
      modelAliasMap: undefined,
      slotModelIds: selectedModel.startsWith('<')
        ? []
        : [selectedModel],
      modelAliases: selectedModel.startsWith('<')
        ? []
        : [toCleanModelAlias(selectedModel, undefined)],
      discoveryModelIds: [],
      discoveryModelAliases: []
    };
  }

  try {
    return await resolveLaunchModelSelection(options, apiKey);
  } catch (error) {
    console.error(`command-cc: dry-run model discovery failed (${error.message}); showing local fallback only`);
    const selectedModel = resolveSelectedModel(options) || '<first-model-from-command-code>';
    return {
      selectedModel,
      modelAliasMap: undefined,
      slotModelIds: selectedModel.startsWith('<')
        ? []
        : [selectedModel],
      modelAliases: selectedModel.startsWith('<')
        ? []
        : [toCleanModelAlias(selectedModel, undefined)],
      discoveryModelIds: [],
      discoveryModelAliases: []
    };
  }
}

async function resolveLaunchModelSelection(options, apiKey) {
  const providerModels = await fetchModels(options.providerBase, apiKey);
  const providerModelIds = modelIdsFromPayload(providerModels);
  const account = await fetchAccountSummary(commandCodeApiBaseFromProviderBase(options.providerBase), apiKey);
  const pickerModelIds = filterModelIdsForPlan(providerModelIds, account, options);
  const selectedModel = resolveKnownModelId(resolveSelectedModel(options), providerModelIds)
    || pickInitialProviderModel(pickerModelIds);

  if (!selectedModel) {
    throw new Error('Command Code returned no models from /provider/v1/models.');
  }

  const modelAliasMap = buildModelAliasMap(unique([selectedModel, ...pickerModelIds]));
  const orderedModelIds = unique([selectedModel, ...pickerModelIds]);
  const slotModelIds = options.cleanModelName
    ? [selectedModel]
    : buildSlotModelIds(selectedModel, orderedModelIds);
  const slotSet = new Set(slotModelIds);
  const selectedAlias = toCleanModelAlias(selectedModel, modelAliasMap);
  const discoveryModelIds = options.cleanModelName
    ? []
    : orderedModelIds.filter((id) => id !== selectedModel && !slotSet.has(id));
  const slotAliases = slotModelIds.map((id) => toCleanModelAlias(id, modelAliasMap));
  const discoveryModelAliases = buildDiscoveryModelAliases(discoveryModelIds, modelAliasMap, options);
  const modelAliases = unique([selectedAlias, ...slotAliases, ...discoveryModelAliases]);

  return {
    providerModels,
    providerModelIds,
    account,
    pickerModelIds,
    selectedModel,
    modelAliasMap,
    modelAliases,
    slotModelIds,
    discoveryModelIds,
    discoveryModelAliases,
    wrapperModelIds: orderedModelIds
  };
}

function buildDiscoveryModelAliases(discoveryModelIds, modelAliasMap, options) {
  return discoveryModelIds.map((id) => toCleanModelAlias(id, modelAliasMap));
}

function buildSlotModelIds(selectedModel, orderedModelIds) {
  const priority = unique([
    ...GO_PLAN_SLOT_PRIORITY.filter((id) => orderedModelIds.includes(id)),
    ...orderedModelIds
  ]);
  return priority
    .filter((id) => id !== selectedModel)
    .slice(0, CLAUDE_MODEL_SLOT_KEYS.length);
}

function firstModelId(models) {
  return modelIdsFromPayload(models)[0];
}

function pickInitialProviderModel(modelIds) {
  const preferred = [
    'xiaomi/mimo-v2.5-pro',
    'moonshotai/Kimi-K2.5',
    'deepseek/deepseek-v4-flash',
    'stepfun/Step-3.7-Flash',
    'google/gemini-3.1-flash-lite'
  ];
  const preferredModel = preferred.find((id) => modelIds.includes(id));
  if (preferredModel) {
    return preferredModel;
  }

  return modelIds.find((id) => !isNativeAnthropicModel(id)) || modelIds[0];
}

function modelIdsFromPayload(models) {
  const data = Array.isArray(models?.data) ? models.data : [];
  return data.map(getModelId).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function buildClaudeArgs(claudeArgs, modelAliases, options) {
  if (!options.restrictModelPicker || modelAliases.length === 0) {
    return claudeArgs;
  }

  const settings = {
    availableModels: modelAliases
  };

  return ['--settings', JSON.stringify(settings), ...claudeArgs];
}

async function readCommandCodeAuth() {
  const authPath = commandCodeAuthPath();

  try {
    const raw = await readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    const apiKey = typeof parsed.apiKey === 'string'
      ? parsed.apiKey
      : findLikelyToken(parsed);

    return {
      ...parsed,
      apiKey,
      authPath
    };
  } catch {
    return undefined;
  }
}

function commandCodeAuthPath() {
  if (process.argv.includes('--local')) {
    return join(homedir(), '.commandcode', 'auth.local.json');
  }

  if (process.argv.includes('--staging')) {
    return join(homedir(), '.commandcode', 'auth.staging.json');
  }

  return join(homedir(), '.commandcode', 'auth.json');
}

function findLikelyToken(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const key of ['apiKey', 'api_key', 'authToken', 'accessToken', 'token', 'key']) {
    if (typeof value[key] === 'string' && value[key].length > 16) {
      return value[key];
    }
  }

  for (const nested of Object.values(value)) {
    const token = findLikelyToken(nested);
    if (token) {
      return token;
    }
  }

  return undefined;
}

async function startGateway(config) {
  const server = createServer((request, response) => {
    handleGatewayRequest(request, response, config).catch((error) => {
      sendAnthropicError(response, 500, 'api_error', error.message);
    });
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(config.port, config.host, resolvePromise);
  });

  const address = server.address();
  return {
    host: config.host,
    port: address.port,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise))
  };
}

async function handleGatewayRequest(request, response, config) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/models') {
    await proxyModels(response, config);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/messages') {
    const body = await readJson(request);
    const upstreamBody = withResolvedModel(body, config.modelAliasMap);
    await proxyAlphaMessages(response, config, upstreamBody);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
    const body = await readJson(request);
    sendJson(response, 200, { input_tokens: estimateTokens(body) });
    return;
  }

  sendAnthropicError(response, 404, 'not_found_error', `No route for ${request.method} ${url.pathname}`);
}

async function proxyModels(response, config) {
  const upstream = await fetch(`${config.providerBase}/v1/models`, {
    headers: providerHeaders(config.apiKey)
  });

  const text = await upstream.text();
  const payload = parseJsonOrText(text);

  if (!upstream.ok) {
    sendProviderErrorAsAnthropic(response, upstream.status, payload);
    return;
  }

  sendJson(response, 200, normalizeModelsForClaudePicker(payload, config.allowedModelIds, config.modelAliasMap, config));
}

async function proxyAlphaMessages(response, config, anthropicBody) {
  const alphaBody = await anthropicToAlphaBody(anthropicBody);
  const upstream = await fetch(`${config.apiBase}/alpha/generate`, {
    method: 'POST',
    headers: alphaHeaders(config.apiKey, alphaBody.threadId),
    body: JSON.stringify(alphaBody)
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    sendAlphaErrorAsAnthropic(response, upstream.status, parseJsonOrText(text));
    return;
  }

  if (!upstream.body) {
    sendAnthropicError(response, 502, 'api_error', 'Command Code app API returned an empty response body.');
    return;
  }

  if (anthropicBody.stream) {
    await pipeAlphaToAnthropicStream(response, upstream.body, anthropicBody.model);
    return;
  }

  const message = await collectAlphaMessage(upstream.body, anthropicBody.model);
  sendJson(response, 200, message);
}

async function proxyAnthropicMessages(request, response, config, body) {
  const upstream = await fetch(`${config.providerBase}/v1/messages`, {
    method: 'POST',
    headers: {
      ...providerHeaders(config.apiKey),
      'content-type': 'application/json',
      'anthropic-version': request.headers['anthropic-version'] || '2023-06-01',
      ...(request.headers['anthropic-beta'] ? { 'anthropic-beta': request.headers['anthropic-beta'] } : {})
    },
    body: JSON.stringify(body)
  });

  if (!upstream.ok) {
    await sendUpstreamError(response, upstream);
    return;
  }

  await pipeUpstream(response, upstream);
}

async function proxyChatAdapter(response, config, anthropicBody) {
  const openAiBody = anthropicToOpenAi(anthropicBody);
  const wantsStream = Boolean(anthropicBody.stream);

  if (wantsStream) {
    openAiBody.stream = false;
  }

  const upstream = await fetch(`${config.providerBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      ...providerHeaders(config.apiKey),
      'content-type': 'application/json'
    },
    body: JSON.stringify(openAiBody)
  });

  const text = await upstream.text();
  const payload = parseJsonOrText(text);

  if (!upstream.ok) {
    sendProviderErrorAsAnthropic(response, upstream.status, payload);
    return;
  }

  const anthropic = openAiToAnthropic(payload, anthropicBody.model);

  if (wantsStream) {
    sendAnthropicStream(response, anthropic);
    return;
  }

  sendJson(response, 200, anthropic);
}

function anthropicToOpenAi(body) {
  const messages = [];
  const system = normalizeText(body.system);

  if (system) {
    messages.push({ role: 'system', content: system });
  }

  for (const message of body.messages || []) {
    messages.push(...convertAnthropicMessage(message));
  }

  const output = {
    model: body.model,
    messages
  };

  if (body.max_tokens) output.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) output.temperature = body.temperature;
  if (body.top_p !== undefined) output.top_p = body.top_p;
  if (body.stop_sequences) output.stop = body.stop_sequences;
  if (body.metadata?.user_id) output.user = body.metadata.user_id;

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    output.tools = body.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    }));
  }

  if (body.tool_choice) {
    output.tool_choice = convertToolChoice(body.tool_choice);
  }

  return output;
}

function convertAnthropicMessage(message) {
  const content = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content || '' }];

  if (message.role === 'assistant') {
    const textParts = [];
    const toolCalls = [];

    for (const part of content) {
      if (part.type === 'text') {
        textParts.push(part.text || '');
      }

      if (part.type === 'tool_use') {
        toolCalls.push({
          id: part.id,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input || {})
          }
        });
      }
    }

    return [{
      role: 'assistant',
      content: textParts.join('\n') || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    }];
  }

  const converted = [];
  const userContent = [];

  for (const part of content) {
    if (part.type === 'tool_result') {
      converted.push({
        role: 'tool',
        tool_call_id: part.tool_use_id,
        content: normalizeText(part.content)
      });
      continue;
    }

    if (part.type === 'text') {
      userContent.push({ type: 'text', text: part.text || '' });
      continue;
    }

    if (part.type === 'image' && part.source?.type === 'base64') {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${part.source.media_type};base64,${part.source.data}`
        }
      });
    }
  }

  if (userContent.length > 0) {
    converted.unshift({
      role: message.role === 'user' ? 'user' : message.role,
      content: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent
    });
  }

  return converted;
}

function convertToolChoice(toolChoice) {
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'tool') {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return 'auto';
}

async function anthropicToAlphaBody(body) {
  const threadId = randomUUID();
  const params = {
    tools: alphaToolsFromAnthropic(body.tools),
    messages: alphaMessagesFromAnthropic(body.messages || []),
    model: body.model,
    system: normalizeText(body.system),
    max_tokens: body.max_tokens || 4096,
    stream: true
  };

  if (body.temperature !== undefined) params.temperature = body.temperature;
  if (body.top_p !== undefined) params.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
    params.stop = body.stop_sequences;
  }

  return {
    config: await commandCodeEnvironmentContext(),
    memory: '',
    taste: '',
    skills: '',
    params,
    threadId
  };
}

function alphaToolsFromAnthropic(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter((tool) => tool && typeof tool.name === 'string')
    .map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.input_schema || tool.inputSchema || { type: 'object', properties: {} }
    }));
}

function alphaMessagesFromAnthropic(messages) {
  const output = [];
  const toolNames = new Map();

  for (const message of messages) {
    const content = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content || '' }];

    if (message.role === 'assistant') {
      const assistantContent = [];

      for (const part of content) {
        if (part.type === 'text' && part.text) {
          assistantContent.push({ type: 'text', text: part.text });
        }

        if (part.type === 'tool_use') {
          const id = part.id || `toolu_${randomUUID().replaceAll('-', '')}`;
          toolNames.set(id, part.name || 'tool');
          assistantContent.push({
            type: 'tool-call',
            toolCallId: id,
            toolName: part.name || 'tool',
            input: part.input || {}
          });
        }
      }

      if (assistantContent.length > 0) {
        output.push({ role: 'assistant', content: assistantContent });
      }

      continue;
    }

    if (message.role === 'user') {
      const textParts = [];
      const toolResults = [];

      for (const part of content) {
        if (part.type === 'tool_result') {
          const toolCallId = part.tool_use_id || part.id || `toolu_${randomUUID().replaceAll('-', '')}`;
          toolResults.push({
            type: 'tool-result',
            toolCallId,
            toolName: toolNames.get(toolCallId) || part.name || 'tool',
            output: {
              type: part.is_error ? 'error-text' : 'text',
              value: normalizeText(part.content)
            }
          });
          continue;
        }

        if (part.type === 'text') {
          textParts.push(part.text || '');
          continue;
        }

        if (part.type === 'image') {
          textParts.push('[Image input omitted by command-cc]');
        }
      }

      const userText = textParts.filter(Boolean).join('\n');
      if (userText) {
        output.push({ role: 'user', content: userText });
      }

      if (toolResults.length > 0) {
        output.push({ role: 'tool', content: toolResults });
      }

      continue;
    }

    if (message.role === 'tool') {
      const toolResults = [];

      for (const part of content) {
        if (part.type === 'tool_result') {
          const toolCallId = part.tool_use_id || part.id || `toolu_${randomUUID().replaceAll('-', '')}`;
          toolResults.push({
            type: 'tool-result',
            toolCallId,
            toolName: toolNames.get(toolCallId) || part.name || 'tool',
            output: {
              type: part.is_error ? 'error-text' : 'text',
              value: normalizeText(part.content)
            }
          });
          continue;
        }

        if (part.tool_call_id || part.toolCallId) {
          const toolCallId = part.tool_call_id || part.toolCallId;
          toolResults.push({
            type: 'tool-result',
            toolCallId,
            toolName: toolNames.get(toolCallId) || part.name || 'tool',
            output: {
              type: part.is_error ? 'error-text' : 'text',
              value: normalizeText(part.content || part.output || part.text)
            }
          });
        }
      }

      if (toolResults.length > 0) {
        output.push({ role: 'tool', content: toolResults });
      } else {
        output.push({ role: 'user', content: normalizeText(message.content) });
      }

      continue;
    }

    output.push({
      role: 'user',
      content: normalizeText(message.content)
    });
  }

  return output;
}

function openAiToAnthropic(payload, fallbackModel) {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];

  if (message.content) {
    content.push({ type: 'text', text: textFromOpenAiContent(message.content) });
  }

  for (const toolCall of message.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id || `toolu_${randomUUID().replaceAll('-', '')}`,
      name: toolCall.function?.name || 'tool',
      input: parseJsonOrFallback(toolCall.function?.arguments || '{}')
    });
  }

  return {
    type: 'message',
    id: `msg_${randomUUID().replaceAll('-', '')}`,
    role: 'assistant',
    model: payload.model || fallbackModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: payload.usage?.prompt_tokens || 0,
      output_tokens: payload.usage?.completion_tokens || 0
    }
  };
}

function withResolvedModel(body, modelAliasMap = new Map()) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  return {
    ...body,
    model: fromGatewayModelAlias(body.model, modelAliasMap)
  };
}

function normalizeModelsForClaudePicker(payload, allowedModelIds, modelAliasMap = new Map(), options = {}) {
  const allowed = Array.isArray(allowedModelIds)
    ? new Set(allowedModelIds)
    : null;
  const data = Array.isArray(payload?.data) ? payload.data : [];

  return {
    type: 'list',
    data: data
      .map((model) => {
        const id = getModelId(model);
        if (!id || allowed && !allowed.has(id)) {
          return undefined;
        }

        return {
          type: 'model',
          id: toCleanModelAlias(id, modelAliasMap),
          display_name: shortModelName(id),
          name: shortModelName(id),
          created_at: getModelCreatedAt(model),
          original_id: id
        };
      })
      .filter(Boolean)
  };
}

function getModelId(model) {
  if (typeof model === 'string') {
    return model;
  }

  if (model && typeof model.id === 'string') {
    return model.id;
  }

  if (model && typeof model.name === 'string') {
    return model.name;
  }

  return undefined;
}

function getModelCreatedAt(model) {
  if (model && Number.isFinite(model.created_at)) {
    return model.created_at;
  }

  if (model && Number.isFinite(model.created)) {
    return model.created;
  }

  return 0;
}

function buildModelAliasMap(modelIds) {
  const map = new Map();
  for (const id of modelIds) {
    toPickerModelAlias(id, map, { cleanModelName: false });
    toCleanModelAlias(id, map);
  }
  return map;
}

function toPickerModelAlias(modelId, modelAliasMap, options = {}) {
  if (options.cleanModelName) {
    return toCleanModelAlias(modelId, modelAliasMap);
  }

  if (typeof modelId !== 'string' || isGatewayModelAlias(modelId)) {
    return modelId;
  }

  if (looksLikeNativeAnthropicModel(modelId)) {
    return modelId;
  }

  const slug = slugifyModelId(shortModelName(modelId));
  let alias = `${GATEWAY_MODEL_PREFIX}${slug}`;
  let suffix = 2;

  while (modelAliasMap?.has(alias) && modelAliasMap.get(alias) !== modelId) {
    alias = `${GATEWAY_MODEL_PREFIX}${slug}-${suffix}`;
    suffix += 1;
  }

  modelAliasMap?.set(alias, modelId);
  return alias;
}

function toCleanModelAlias(modelId, modelAliasMap) {
  if (typeof modelId !== 'string') {
    return modelId;
  }

  if (modelId.startsWith('anthropic-command-code-')) {
    return slugifyModelId(shortModelName(base64UrlDecode(modelId.slice('anthropic-command-code-'.length))));
  }

  const slug = slugifyModelId(shortModelName(modelId));
  let alias = slug;
  let suffix = 2;

  while (modelAliasMap?.has(alias) && modelAliasMap.get(alias) !== modelId) {
    alias = `${slug}-${suffix}`;
    suffix += 1;
  }

  modelAliasMap?.set(alias, modelId);
  return alias;
}

function fromGatewayModelAlias(modelId, modelAliasMap = new Map()) {
  if (typeof modelId !== 'string') {
    return modelId;
  }

  const mapped = modelAliasMap.get(modelId);
  if (mapped) {
    return mapped;
  }

  if (modelId.startsWith('anthropic-command-code-')) {
    return base64UrlDecode(modelId.slice('anthropic-command-code-'.length));
  }

  if (isGatewayModelAlias(modelId) && modelId.startsWith(GATEWAY_MODEL_PREFIX)) {
    return modelId.slice(GATEWAY_MODEL_PREFIX.length);
  }

  return modelId;
}

function isGatewayModelAlias(modelId) {
  if (typeof modelId !== 'string') {
    return false;
  }

  if (LEGACY_GATEWAY_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))) {
    return true;
  }

  return modelId.startsWith(GATEWAY_MODEL_PREFIX) && !looksLikeNativeAnthropicModel(modelId);
}

function slugifyModelId(modelId) {
  return modelId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || base64UrlEncode(modelId).toLowerCase();
}

function shortModelName(modelId) {
  if (typeof modelId !== 'string') {
    return '';
  }

  const parts = modelId.split('/').filter(Boolean);
  return parts[parts.length - 1] || modelId;
}

function displayModelNameForAlias(alias, modelAliasMap) {
  if (typeof alias === 'string' && !alias.includes('/') && !isGatewayModelAlias(alias)) {
    return alias;
  }

  const modelId = fromGatewayModelAlias(alias, modelAliasMap);
  return modelId.includes('/') ? modelId : shortModelName(modelId);
}

function resolveKnownModelId(modelId, knownModelIds) {
  if (!modelId) {
    return undefined;
  }

  const decoded = fromGatewayModelAlias(modelId);
  if (knownModelIds.includes(decoded)) {
    return decoded;
  }

  const normalized = slugifyModelId(decoded);
  const legacyClean = decoded.replace(/^claude-(?:cc-)?/, '');
  return knownModelIds.find((id) => shortModelName(id) === decoded)
    || knownModelIds.find((id) => slugifyModelId(shortModelName(id)) === normalized)
    || knownModelIds.find((id) => slugifyModelId(id) === normalized)
    || knownModelIds.find((id) => slugifyModelId(shortModelName(id)) === legacyClean)
    || knownModelIds.find((id) => slugifyModelId(id) === legacyClean);
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlDecode(value) {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  return Buffer.from(padded.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

function textFromOpenAiContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === 'string' ? part : part.text || '')
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function mapFinishReason(reason) {
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'tool-calls') return 'tool_use';
  if (reason === 'content_filter') return 'stop_sequence';
  return 'end_turn';
}

function sendAnthropicStream(response, message) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  writeSse(response, 'message_start', {
    type: 'message_start',
    message: {
      id: message.id,
      type: 'message',
      role: 'assistant',
      model: message.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 }
    }
  });

  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      writeSse(response, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' }
      });
      writeSse(response, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text }
      });
      writeSse(response, 'content_block_stop', { type: 'content_block_stop', index });
      return;
    }

    writeSse(response, 'content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: {}
      }
    });
    writeSse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) }
    });
    writeSse(response, 'content_block_stop', { type: 'content_block_stop', index });
  });

  writeSse(response, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: message.stop_reason,
      stop_sequence: null
    },
    usage: { output_tokens: message.usage.output_tokens }
  });
  writeSse(response, 'message_stop', { type: 'message_stop' });
  response.end();
}

async function pipeAlphaToAnthropicStream(response, body, fallbackModel) {
  const state = createAlphaAnthropicState(fallbackModel);

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  writeSse(response, 'message_start', {
    type: 'message_start',
    message: {
      id: state.id,
      type: 'message',
      role: 'assistant',
      model: fallbackModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  });

  await consumeAlphaJsonLines(body, (event) => {
    applyAlphaEventToStream(response, state, event);
  });

  finishAlphaStream(response, state);
}

async function collectAlphaMessage(body, fallbackModel) {
  const state = createAlphaAnthropicState(fallbackModel);

  await consumeAlphaJsonLines(body, (event) => {
    applyAlphaEventToMessage(state, event);
  });

  return {
    type: 'message',
    id: state.id,
    role: 'assistant',
    model: fallbackModel,
    content: state.content,
    stop_reason: state.stopReason || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens
    }
  };
}

function createAlphaAnthropicState(model) {
  return {
    id: `msg_${randomUUID().replaceAll('-', '')}`,
    model,
    content: [],
    nextIndex: 0,
    textIndex: null,
    textOpen: false,
    inputTokens: 0,
    outputTokens: 0,
    stopReason: 'end_turn'
  };
}

async function consumeAlphaJsonLines(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';

      for (const line of lines) {
        const event = parseAlphaLine(line);
        if (event) {
          onEvent(event);
        }
      }
    }

    buffered += decoder.decode();
    const event = parseAlphaLine(buffered);
    if (event) {
      onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseAlphaLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function applyAlphaEventToStream(response, state, event) {
  if (event.type === 'text-delta') {
    ensureAlphaTextBlock(response, state);
    writeSse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index: state.textIndex,
      delta: { type: 'text_delta', text: event.text || '' }
    });
    return;
  }

  if (event.type === 'tool-call') {
    closeAlphaTextBlock(response, state);
    const index = state.nextIndex;
    state.nextIndex += 1;
    writeSse(response, 'content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: event.toolCallId || `toolu_${randomUUID().replaceAll('-', '')}`,
        name: event.toolName || 'tool',
        input: {}
      }
    });
    writeSse(response, 'content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(event.input || event.args || {}) }
    });
    writeSse(response, 'content_block_stop', { type: 'content_block_stop', index });
    state.stopReason = 'tool_use';
    return;
  }

  if (event.type === 'finish' || event.type === 'finish-step') {
    applyAlphaUsage(state, event.totalUsage || event.usage);
    state.stopReason = mapFinishReason(event.finishReason || event.rawFinishReason);
    return;
  }

  if (event.type === 'error') {
    throw new Error(extractProviderErrorMessage(event.error || event) || 'Command Code app API stream error.');
  }
}

function applyAlphaEventToMessage(state, event) {
  if (event.type === 'text-delta') {
    let block = state.content[state.content.length - 1];
    if (!block || block.type !== 'text') {
      block = { type: 'text', text: '' };
      state.content.push(block);
    }
    block.text += event.text || '';
    return;
  }

  if (event.type === 'tool-call') {
    state.content.push({
      type: 'tool_use',
      id: event.toolCallId || `toolu_${randomUUID().replaceAll('-', '')}`,
      name: event.toolName || 'tool',
      input: event.input || event.args || {}
    });
    state.stopReason = 'tool_use';
    return;
  }

  if (event.type === 'finish' || event.type === 'finish-step') {
    applyAlphaUsage(state, event.totalUsage || event.usage);
    state.stopReason = mapFinishReason(event.finishReason || event.rawFinishReason);
    return;
  }

  if (event.type === 'error') {
    throw new Error(extractProviderErrorMessage(event.error || event) || 'Command Code app API stream error.');
  }
}

function ensureAlphaTextBlock(response, state) {
  if (state.textOpen) {
    return;
  }

  state.textIndex = state.nextIndex;
  state.nextIndex += 1;
  state.textOpen = true;
  writeSse(response, 'content_block_start', {
    type: 'content_block_start',
    index: state.textIndex,
    content_block: { type: 'text', text: '' }
  });
}

function closeAlphaTextBlock(response, state) {
  if (!state.textOpen) {
    return;
  }

  writeSse(response, 'content_block_stop', {
    type: 'content_block_stop',
    index: state.textIndex
  });
  state.textOpen = false;
  state.textIndex = null;
}

function finishAlphaStream(response, state) {
  closeAlphaTextBlock(response, state);
  writeSse(response, 'message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: state.stopReason || 'end_turn',
      stop_sequence: null
    },
    usage: { output_tokens: state.outputTokens }
  });
  writeSse(response, 'message_stop', { type: 'message_stop' });
  response.end();
}

function applyAlphaUsage(state, usage) {
  if (!usage || typeof usage !== 'object') {
    return;
  }

  state.inputTokens = usage.inputTokens || usage.input_tokens || state.inputTokens || 0;
  state.outputTokens = usage.outputTokens || usage.output_tokens || state.outputTokens || 0;
}

function writeSse(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function pipeUpstream(response, upstream) {
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8'
  };

  if ((headers['content-type'] || '').includes('text/event-stream')) {
    headers['cache-control'] = 'no-cache';
    headers.connection = 'keep-alive';
  }

  response.writeHead(upstream.status, headers);

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(Buffer.from(value));
  }

  response.end();
}

function providerHeaders(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey
  };
}

function alphaHeaders(apiKey, sessionId) {
  return {
    ...commandCodeHeaders(apiKey),
    'x-project-slug': currentProjectSlug(),
    'x-co-flag': 'false',
    'x-taste-learning': 'false',
    'x-session-id': sessionId
  };
}

function commandCodeHeaders(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'x-command-code-version': COMMAND_CODE_CLI_VERSION,
    'x-cli-environment': 'production'
  };
}

function commandCodeApiBaseFromProviderBase(providerBase) {
  const base = (providerBase || DEFAULT_PROVIDER_BASE).replace(/\/+$/, '');
  if (base.endsWith('/provider')) {
    return base.slice(0, -'/provider'.length) || DEFAULT_API_BASE;
  }
  return DEFAULT_API_BASE;
}

async function commandCodeEnvironmentContext() {
  const cwd = process.cwd();
  const isGitRepo = isGitRepository(cwd);

  return {
    workingDir: cwd,
    date: new Date().toISOString().split('T')[0],
    environment: `${platform()}-${arch()}, Node.js ${process.version}`,
    structure: await getRootDirectoryStructure(cwd),
    isGitRepo,
    currentBranch: isGitRepo ? gitOutput(cwd, ['branch', '--show-current']) : '',
    mainBranch: isGitRepo ? getMainBranch(cwd) : '',
    gitStatus: isGitRepo ? getGitStatus(cwd) : '',
    recentCommits: isGitRepo ? getRecentCommits(cwd) : []
  };
}

async function getRootDirectoryStructure(cwd) {
  const ignored = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.svn',
    '.hg',
    'coverage',
    '.nyc_output',
    '.cache',
    'tmp',
    'temp',
    '.next',
    '.nuxt',
    'out'
  ]);

  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith('.'))
      .filter((entry) => !ignored.has(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function isGitRepository(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function getMainBranch(cwd) {
  const originHead = gitOutput(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    .replace(/^origin\//, '');
  if (originHead) {
    return originHead;
  }

  const branches = gitOutput(cwd, ['branch', '-r']);
  if (branches.includes('origin/main')) return 'main';
  if (branches.includes('origin/master')) return 'master';
  return 'main';
}

function getGitStatus(cwd) {
  const status = gitOutput(cwd, ['status', '--porcelain']);
  if (!status) {
    return 'Working tree clean';
  }

  const lines = status.split('\n');
  const modified = lines.filter((line) => line.startsWith(' M')).length;
  const added = lines.filter((line) => line.startsWith('A ')).length;
  const deleted = lines.filter((line) => line.startsWith(' D')).length;
  const untracked = lines.filter((line) => line.startsWith('??')).length;
  const summary = [];

  if (modified > 0) summary.push(`M ${modified}`);
  if (added > 0) summary.push(`A ${added}`);
  if (deleted > 0) summary.push(`D ${deleted}`);
  if (untracked > 0) summary.push(`?? ${untracked}`);
  return summary.join(', ') || status;
}

function getRecentCommits(cwd) {
  return gitOutput(cwd, ['log', '--oneline', '-3'])
    .split('\n')
    .filter(Boolean);
}

function gitOutput(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function currentProjectSlug() {
  return (process.cwd().split(/[\\/]/).filter(Boolean).pop() || 'command-cc')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'command-cc';
}

async function fetchCommandCodeJson(apiBase, apiKey, endpoint) {
  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc login" first.');
  }

  const upstream = await fetch(`${apiBase}${endpoint}`, {
    headers: commandCodeHeaders(apiKey)
  });
  const text = await upstream.text();

  if (!upstream.ok) {
    throw new Error(formatAlphaErrorMessage(upstream.status, parseJsonOrText(text)));
  }

  return parseJsonOrError(text || '{}');
}

async function fetchAccountSummary(apiBase, apiKey) {
  if (!apiKey) {
    return {};
  }

  const [whoamiResult, subscriptionResult] = await Promise.allSettled([
    fetchCommandCodeJson(apiBase, apiKey, '/alpha/whoami'),
    fetchCommandCodeJson(apiBase, apiKey, '/alpha/billing/subscriptions')
  ]);
  const whoami = whoamiResult.status === 'fulfilled' ? whoamiResult.value : {};
  const subscriptionPayload = subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : {};
  const subscription = subscriptionPayload.data || subscriptionPayload.subscription || subscriptionPayload;

  return {
    userName: whoami.user?.userName || whoami.user?.name || '',
    orgLogin: whoami.org?.login || '',
    planId: subscription?.planId || '',
    subscriptionStatus: subscription?.status || '',
    currentPeriodStart: subscription?.currentPeriodStart || '',
    currentPeriodEnd: subscription?.currentPeriodEnd || ''
  };
}

function filterModelIdsForPlan(modelIds, account, options) {
  if (!options.filterModelsByPlan || !isGoPlan(account?.planId)) {
    return modelIds;
  }

  const filtered = modelIds.filter(isGoPlanModelId);
  return filtered.length > 0 ? filtered : modelIds;
}

function isGoPlan(planId) {
  return typeof planId === 'string' && /(^|-)go$/i.test(planId);
}

function isGoPlanModelId(modelId) {
  if (GO_PLAN_MODEL_IDS.has(modelId)) {
    return true;
  }

  const normalized = slugifyModelId(modelId);
  const short = slugifyModelId(shortModelName(modelId));
  for (const allowedId of GO_PLAN_MODEL_IDS) {
    if (
      slugifyModelId(allowedId) === normalized
      || slugifyModelId(shortModelName(allowedId)) === short
    ) {
      return true;
    }
  }

  return false;
}

async function fetchModels(providerBase, apiKey) {
  if (!apiKey) {
    throw new Error('Missing Command Code API key. Run "command-cc setup", set COMMAND_CODE_API_KEY, or pass --api-key.');
  }

  const upstream = await fetch(`${providerBase}/v1/models`, {
    headers: apiKey ? providerHeaders(apiKey) : {}
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(formatProviderErrorMessage(upstream.status, parseJsonOrText(text)));
  }

  return parseJsonOrError(text);
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return parseJsonOrError(text || '{}');
}

function parseJsonOrError(text) {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }
}

function parseJsonOrText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJsonOrFallback(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { value: text };
  }
}

function normalizeText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => typeof part === 'string' ? part : part.text || JSON.stringify(part))
      .join('\n');
  }
  return JSON.stringify(value);
}

function estimateTokens(body) {
  const text = JSON.stringify(body);
  return Math.max(1, Math.ceil(text.length / 4));
}

function isNativeAnthropicModel(model) {
  return looksLikeNativeAnthropicModel(model) && !isGatewayModelAlias(model);
}

function looksLikeNativeAnthropicModel(model) {
  return typeof model === 'string'
    && (
      /^anthropic[\w./:-]*/i.test(model)
      || /^claude-(?:\d|opus|sonnet|haiku|instant|latest)/i.test(model)
    );
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function sendUpstreamError(response, upstream) {
  const text = await upstream.text();
  sendProviderErrorAsAnthropic(response, upstream.status, parseJsonOrText(text));
}

function sendProviderErrorAsAnthropic(response, status, payload) {
  console.error(`command-cc: ${formatProviderErrorMessage(status, payload)}`);
  sendAnthropicError(
    response,
    mapProviderHttpStatus(status, payload),
    mapProviderErrorType(status, payload),
    formatProviderErrorMessage(status, payload)
  );
}

function sendAlphaErrorAsAnthropic(response, status, payload) {
  const message = formatAlphaErrorMessage(status, payload);
  console.error(`command-cc: ${message}`);
  sendAnthropicError(
    response,
    mapAlphaHttpStatus(status, payload),
    mapAlphaErrorType(status, payload),
    message
  );
}

function mapProviderHttpStatus(status, payload) {
  if (isProviderPlanError(status, payload)) {
    return 402;
  }

  return status;
}

function mapAlphaHttpStatus(status, payload) {
  if (isAlphaPlanError(status, payload)) {
    return 402;
  }

  return status;
}

function mapProviderErrorType(status, payload) {
  const type = payload && typeof payload === 'object' ? payload.error?.type : undefined;
  if (type === 'authentication_error' || status === 401) return 'authentication_error';
  if (type === 'rate_limit_error' || status === 429) return 'rate_limit_error';
  if (type === 'permission_error' || status === 403) return 'permission_error';
  return 'api_error';
}

function mapAlphaErrorType(status, payload) {
  const code = payload && typeof payload === 'object' ? payload.error?.code || payload.code : undefined;
  if (status === 401) return 'authentication_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 403 || code === 'FORBIDDEN') return 'permission_error';
  return 'api_error';
}

function formatProviderErrorMessage(status, payload) {
  const upstreamMessage = extractProviderErrorMessage(payload);

  if (isProviderPlanError(status, payload)) {
    return [
      'Command Code Provider API returned upgrade_required.',
      'Run "command-cc login" to make sure this wrapper is using your Command Code account.',
      'If this continues after login, that account key is valid but the plan does not include Provider API access.',
      'Upgrade to Provider or higher at https://commandcode.ai/billing, or use the Command Code CLI directly.'
    ].join(' ');
  }

  return `Command Code Provider API returned ${status}: ${upstreamMessage || 'request failed.'}`;
}

function formatAlphaErrorMessage(status, payload) {
  const upstreamMessage = extractProviderErrorMessage(payload);

  if (isAlphaPlanError(status, payload)) {
    return `Command Code model is not included in this account plan: ${upstreamMessage || 'plan access denied.'}`;
  }

  return `Command Code app API returned ${status}: ${upstreamMessage || 'request failed.'}`;
}

function isProviderPlanError(status, payload) {
  if (status !== 403) {
    return false;
  }

  return /plan|provider or higher|billing|doesn'?t include api access|api access/i
    .test(extractProviderErrorMessage(payload));
}

function isAlphaPlanError(status, payload) {
  if (status !== 403) {
    return false;
  }

  const code = payload && typeof payload === 'object' ? payload.error?.code || payload.code : '';
  return code === 'FORBIDDEN' && /MODEL_NOT_IN_PLAN|plan|billing|credits/i
    .test(extractProviderErrorMessage(payload));
}

function extractProviderErrorMessage(payload) {
  if (!payload) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload.error === 'string') {
    return payload.error;
  }

  if (payload.error?.message) {
    return payload.error.message;
  }

  if (payload.message) {
    return payload.message;
  }

  if (payload.detail) {
    return typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
  }

  return JSON.stringify(payload);
}

function sendAnthropicError(response, status, type, message) {
  if (response.headersSent) {
    response.end();
    return;
  }

  sendJson(response, status, {
    type: 'error',
    error: { type, message }
  });
}

async function findExecutable(binaryName) {
  const pathValue = process.env.PATH || '';

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;

    for (const name of candidateNames(binaryName)) {
      const fullPath = join(dir, name);
      if (await canExecute(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

function candidateNames(binaryName) {
  if (process.platform !== 'win32' || /\.[^\\/]+$/.test(binaryName)) {
    return [binaryName];
  }

  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .filter((extension) => extension.toUpperCase() !== '.PS1');

  return [...pathExt.map((extension) => `${binaryName}${extension.toLowerCase()}`), binaryName];
}

async function canExecute(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnAndForward(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const prepared = prepareSpawn(command, args);
    const child = spawn(prepared.command, prepared.args, {
      cwd: resolve(process.cwd()),
      env: options.env,
      stdio: 'inherit',
      windowsHide: false
    });

    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exitCode = code ?? 1;
      resolvePromise(code ?? 1);
    });
  });
}

function prepareSpawn(command, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args]
    };
  }

  return { command, args };
}

function formatCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(String(value))) {
    return String(value);
  }

  return JSON.stringify(String(value));
}

function printEnvSummary(env, options) {
  console.log('');
  console.log('Environment overrides:');
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${value}`);
  }
  console.log(`${options.apiKeyEnv}=<read by local gateway>`);
}
