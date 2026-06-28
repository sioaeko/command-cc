#!/usr/bin/env node

import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import process from 'node:process';

const VERSION = '0.9.0';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SERVE_PORT = 8000;
const DEFAULT_GATEWAY_REPO = 'https://github.com/Jwadow/kiro-gateway.git';
const CONFIG_DIR = join(homedir(), '.command-claudecode');
const DEFAULT_GATEWAY_DIR = join(CONFIG_DIR, 'kiro-gateway');
const KIRO_CC_CONFIG_PATH = join(CONFIG_DIR, 'kiro-cc.json');
const CLAUDE_MODEL_SLOT_KEYS = [
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION'
];
const KIRO_MODEL_SLOT_PRIORITY = [
  'auto',
  'claude-sonnet-4.6',
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-haiku-4.5',
  'deepseek-3.2',
  'minimax-m2.5',
  'glm-5',
  'qwen3-coder-next'
];
const FALLBACK_MODELS = [
  'auto',
  'claude-sonnet-4.6',
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-haiku-4.5',
  'deepseek-3.2',
  'minimax-m2.5',
  'glm-5',
  'qwen3-coder-next'
];

const COMMANDS = new Set([
  'setup',
  'serve',
  'models',
  'doctor',
  'login',
  'logout',
  'whoami',
  'help'
]);

main().catch((error) => {
  console.error(`kiro-cc: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.options.version) {
    console.log(VERSION);
    return;
  }

  if (parsed.command === 'help' || parsed.options.help) {
    printHelp();
    return;
  }

  const userConfig = await readJsonIfExists(KIRO_CC_CONFIG_PATH);
  const options = withDefaults(parsed.options, userConfig || {});

  switch (parsed.command) {
    case 'setup':
      await setupGateway(options);
      break;
    case 'serve':
      await serveGateway(options);
      break;
    case 'models':
      await listModels(options);
      break;
    case 'doctor':
      await doctor(options);
      break;
    case 'login':
    case 'logout':
    case 'whoami':
      await runKiroCliCommand(parsed.command, options);
      break;
    default:
      await launchClaudeThroughKiro(options, parsed.claudeArgs);
      break;
  }
}

function printHelp() {
  console.log(`kiro-cc ${VERSION}

Launch Claude Code with model requests routed through a local Kiro Gateway.

This wrapper does not include or modify Kiro, Claude Code, or Kiro Gateway. It
installs/runs Jwadow/kiro-gateway as an external local dependency when needed.

Usage:
  kiro-cc [options] [-- <claude args...>]
  kiro-cc setup [options]
  kiro-cc serve [options]
  kiro-cc models [--json]
  kiro-cc doctor
  kiro-cc login|logout|whoami

Options:
  --model <id>          Initial Kiro model. Default: Kiro CLI default or auto.
  --port <port>         Gateway port. Default: random for launch, 8000 for serve.
  --host <host>         Gateway host. Default: 127.0.0.1.
  --gateway-dir <path>  Kiro Gateway checkout directory.
  --repo <url>          Kiro Gateway git repo.
  --kiro <path>         Kiro CLI executable.
  --claude <path>       Claude Code executable.
  --python <path>       Python executable.
  --no-install          Do not auto-install/update Kiro Gateway.
  --dry-run             Print launch settings without starting Claude Code.
  --json                JSON output for models.
  -h, --help            Show help.
  -V, --version         Show wrapper version.

Examples:
  kiro-cc setup
  kiro-cc models
  kiro-cc --model claude-sonnet-4.6
  kiro-cc --model auto -- -p "explain this repo"
  kiro-cc serve --port 8000
`);
}

function parseArgs(argv) {
  const dashDash = argv.indexOf('--');
  const ownArgs = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const claudeArgs = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  let command = 'run';
  const options = {};

  if (ownArgs.length > 0 && COMMANDS.has(ownArgs[0])) {
    command = ownArgs.shift();
  }

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = ownArgs[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '-V' || arg === '--version') {
      options.version = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-install') {
      options.noInstall = true;
      continue;
    }
    if (arg === '--update') {
      options.update = true;
      continue;
    }
    if (arg === '--no-update') {
      options.update = false;
      continue;
    }
    if (arg === '--model' || arg === '-m') {
      options.model = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--port' || arg === '-p') {
      options.port = Number.parseInt(requireValue(ownArgs, index, arg), 10);
      if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
        throw new Error(`Invalid --port: ${ownArgs[index + 1]}`);
      }
      index += 1;
      continue;
    }
    if (arg === '--host' || arg === '-H') {
      options.host = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--gateway-dir' || arg === '--install-dir') {
      options.gatewayDir = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--repo') {
      options.repo = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--kiro' || arg === '--kiro-cli') {
      options.kiroCli = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--claude') {
      options.claude = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--python') {
      options.python = requireValue(ownArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { command, options, claudeArgs };
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function withDefaults(options, config) {
  return {
    host: options.host || config.host || DEFAULT_HOST,
    port: options.port || undefined,
    gatewayDir: resolve(options.gatewayDir || config.gatewayDir || DEFAULT_GATEWAY_DIR),
    repo: options.repo || config.repo || DEFAULT_GATEWAY_REPO,
    kiroCli: options.kiroCli || config.kiroCli,
    claude: options.claude || config.claude || process.env.CLAUDE_CODE_CLI || 'claude',
    python: options.python || config.python,
    model: options.model || config.model || process.env.KIRO_CC_MODEL,
    json: Boolean(options.json),
    dryRun: Boolean(options.dryRun),
    noInstall: Boolean(options.noInstall),
    update: options.update
  };
}

async function setupGateway(options) {
  const gatewayDir = options.gatewayDir;
  const python = await resolvePython(options);
  await mkdir(dirname(gatewayDir), { recursive: true });

  if (!(await pathExists(join(gatewayDir, '.git')))) {
    console.error(`kiro-cc: cloning Kiro Gateway into ${gatewayDir}`);
    await runChecked('git', ['clone', '--depth', '1', options.repo, gatewayDir], { stdio: 'inherit' });
  } else if (options.update !== false) {
    console.error(`kiro-cc: updating Kiro Gateway in ${gatewayDir}`);
    await runChecked('git', ['-C', gatewayDir, 'pull', '--ff-only'], { stdio: 'inherit' });
  }

  const venvPython = await ensureVenv(gatewayDir, python);
  const requirementsPath = join(gatewayDir, 'requirements.txt');
  if (!(await pathExists(requirementsPath))) {
    throw new Error(`Kiro Gateway checkout is missing requirements.txt: ${gatewayDir}`);
  }

  console.error('kiro-cc: installing Kiro Gateway Python dependencies');
  await runChecked(venvPython.cmd, [...venvPython.args, '-m', 'pip', 'install', '-r', requirementsPath], {
    stdio: 'inherit'
  });

  const envPath = join(gatewayDir, '.env');
  const dotEnv = await readDotEnv(envPath);
  if (!dotEnv.PROXY_API_KEY) {
    dotEnv.PROXY_API_KEY = `kiro-cc-${randomBytes(24).toString('base64url')}`;
  }
  if (!dotEnv.KIRO_CLI_DB_FILE) {
    dotEnv.KIRO_CLI_DB_FILE = normalizeEnvPath(defaultKiroCliDbPath());
  }
  await writeDotEnv(envPath, dotEnv);
  await writeJson(KIRO_CC_CONFIG_PATH, {
    gatewayDir,
    repo: options.repo,
    host: options.host,
    claude: options.claude,
    ...(options.kiroCli ? { kiroCli: options.kiroCli } : {}),
    ...(options.python ? { python: options.python } : {}),
    ...(options.model ? { model: options.model } : {})
  });

  console.log(`Kiro Gateway ready: ${gatewayDir}`);
  console.log(`Kiro CLI DB: ${dotEnv.KIRO_CLI_DB_FILE}`);
  console.log(`Proxy key: ${maskSecret(dotEnv.PROXY_API_KEY)}`);
  console.log('Run "kiro-cc models" to verify Kiro login/model discovery.');
}

async function serveGateway(options) {
  const port = options.port || DEFAULT_SERVE_PORT;
  if (!options.noInstall) {
    await ensureGatewayReady(options);
  } else {
    await assertGatewayInstalled(options.gatewayDir);
  }

  const gateway = await buildGatewayRuntime(options.gatewayDir, options);
  const upstreamPort = await pickFreePort(options.host);
  const upstreamBaseUrl = `http://${options.host}:${upstreamPort}`;
  const adapterBaseUrl = `http://${options.host}:${port}`;
  console.error(`kiro-cc: starting Kiro Gateway upstream at ${upstreamBaseUrl}`);
  const gatewayProcess = spawn(gateway.python.cmd, [
    ...gateway.python.args,
    'main.py',
    '--host',
    options.host,
    '--port',
    String(upstreamPort)
  ], {
    cwd: options.gatewayDir,
    env: gateway.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const gatewayLogs = [];
  captureProcessLog(gatewayProcess.stdout, gatewayLogs);
  captureProcessLog(gatewayProcess.stderr, gatewayLogs);
  let adapter;
  try {
    await waitForGateway(upstreamBaseUrl, gatewayProcess, gatewayLogs);
    adapter = await startKiroAdapter({
      host: options.host,
      port,
      upstreamBaseUrl,
      proxyApiKey: gateway.proxyApiKey
    });
    console.error(`kiro-cc: serving Claude-compatible Kiro adapter at ${adapterBaseUrl}`);
    console.error(`kiro-cc: proxy key ${maskSecret(gateway.proxyApiKey)}`);
    await waitForever(gatewayProcess, adapter.server);
  } finally {
    killProcess(gatewayProcess);
    if (adapter) {
      await closeServer(adapter.server).catch(() => {});
    }
  }
}

async function listModels(options) {
  const kiroCli = await resolveKiroCli(options);
  const payload = await fetchKiroCliModels(kiroCli);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`default model: ${payload.default_model || 'auto'}`);
  for (const model of payload.models || []) {
    const id = model.model_id || model.id || model.model_name;
    const description = model.description ? ` - ${model.description}` : '';
    const context = model.context_window_tokens ? ` (${formatInteger(model.context_window_tokens)} ctx)` : '';
    const rate = model.rate_multiplier ? ` x${model.rate_multiplier} ${model.rate_unit || 'Credit'}` : '';
    console.log(`${id}${context}${rate}${description}`);
  }
}

async function doctor(options) {
  console.log(`kiro-cc: ${VERSION}`);
  console.log(`gateway dir: ${options.gatewayDir}`);

  try {
    const python = await resolvePython(options);
    const version = await execCapture(python.cmd, [...python.args, '--version']);
    console.log(`python: ok (${oneLine(version.stdout || version.stderr)})`);
  } catch (error) {
    console.log(`python: failed (${error.message})`);
  }

  try {
    await execCapture('git', ['--version']);
    console.log('git: ok');
  } catch (error) {
    console.log(`git: failed (${error.message})`);
  }

  try {
    const kiroCli = await resolveKiroCli(options);
    const version = await execCapture(kiroCli, ['--version']);
    console.log(`kiro cli: ok (${kiroCli}, ${oneLine(version.stdout || version.stderr)})`);
    try {
      const whoami = await execCapture(kiroCli, ['whoami'], { timeoutMs: 15000 });
      console.log(`kiro login: ok (${oneLine(whoami.stdout || whoami.stderr) || 'logged in'})`);
    } catch (error) {
      console.log(`kiro login: failed (${error.message})`);
      console.log('kiro login fix: run "kiro-cc login"');
    }
    try {
      const models = await fetchKiroCliModels(kiroCli);
      console.log(`kiro models: ok (${models.models?.length || 0} models, default ${models.default_model || 'auto'})`);
    } catch (error) {
      console.log(`kiro models: failed (${error.message})`);
    }
  } catch (error) {
    console.log(`kiro cli: failed (${error.message})`);
  }

  try {
    await execCapture(options.claude, ['--version']);
    console.log(`claude code: ok (${options.claude})`);
  } catch (error) {
    console.log(`claude code: failed (${error.message})`);
  }

  const installed = await pathExists(join(options.gatewayDir, 'main.py'));
  console.log(`gateway install: ${installed ? 'ok' : 'missing (run "kiro-cc setup")'}`);
  if (installed) {
    const venvPython = await venvPythonCommand(options.gatewayDir);
    console.log(`gateway venv: ${(await pathExists(venvPython.cmd)) ? 'ok' : 'missing (run "kiro-cc setup")'}`);
    const dotEnv = await readDotEnv(join(options.gatewayDir, '.env'));
    console.log(`proxy key: ${dotEnv.PROXY_API_KEY ? `ok (${maskSecret(dotEnv.PROXY_API_KEY)})` : 'missing'}`);
    console.log(`kiro db: ${dotEnv.KIRO_CLI_DB_FILE || '(not set)'}`);
  }
}

async function runKiroCliCommand(command, options) {
  const kiroCli = await resolveKiroCli(options);
  await spawnForeground(kiroCli, [command], {
    cwd: process.cwd(),
    env: process.env
  });
}

async function launchClaudeThroughKiro(options, claudeArgs) {
  const kiroCli = await resolveKiroCli(options);
  const kiroModels = await fetchKiroCliModels(kiroCli).catch(() => ({
    default_model: 'auto',
    models: FALLBACK_MODELS.map((id) => ({ model_id: id }))
  }));
  const modelIds = unique((kiroModels.models || [])
    .map((model) => model.model_id || model.id || model.model_name)
    .filter(Boolean));
  const selectedModel = options.model || kiroModels.default_model || 'auto';
  const visibleModels = buildVisibleModels(selectedModel, modelIds.length ? modelIds : FALLBACK_MODELS);

  const adapterPort = options.port || await pickFreePort(options.host);
  const gatewayPort = await pickFreePort(options.host);
  const baseUrl = `http://${options.host}:${adapterPort}`;

  if (options.dryRun) {
    const dotEnv = await readDotEnv(join(options.gatewayDir, '.env'));
    const proxyApiKey = dotEnv.PROXY_API_KEY || '<generated-by-kiro-cc-setup>';
    const env = buildClaudeEnv(baseUrl, selectedModel, visibleModels, proxyApiKey);
    printDryRun(baseUrl, selectedModel, visibleModels, env, claudeArgs);
    return;
  }

  if (!options.noInstall) {
    await ensureGatewayReady(options);
  } else {
    await assertGatewayInstalled(options.gatewayDir);
  }

  const gatewayRuntime = await buildGatewayRuntime(options.gatewayDir, options);
  const upstreamBaseUrl = `http://${options.host}:${gatewayPort}`;
  const gateway = spawn(gatewayRuntime.python.cmd, [
    ...gatewayRuntime.python.args,
    'main.py',
    '--host',
    options.host,
    '--port',
    String(gatewayPort)
  ], {
    cwd: options.gatewayDir,
    env: gatewayRuntime.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const gatewayLogs = [];
  captureProcessLog(gateway.stdout, gatewayLogs);
  captureProcessLog(gateway.stderr, gatewayLogs);

  try {
    await waitForGateway(upstreamBaseUrl, gateway, gatewayLogs);
    const adapter = await startKiroAdapter({
      host: options.host,
      port: adapterPort,
      upstreamBaseUrl,
      proxyApiKey: gatewayRuntime.proxyApiKey
    });
    const env = buildClaudeEnv(baseUrl, selectedModel, visibleModels, gatewayRuntime.proxyApiKey);
    const args = buildClaudeArgs(claudeArgs, visibleModels, env);
    console.error(`kiro-cc: routing Claude Code through ${baseUrl}`);
    console.error(`kiro-cc: Kiro Gateway upstream ${upstreamBaseUrl}`);
    console.error(`kiro-cc: requested model ${selectedModel}`);
    console.error(`kiro-cc: visible models ${visibleModels.join(', ')}`);
    try {
      await spawnClaude(options.claude, args, env, gateway);
    } finally {
      await closeServer(adapter.server);
    }
  } finally {
    killProcess(gateway);
  }
}

function buildVisibleModels(selectedModel, modelIds) {
  const priority = KIRO_MODEL_SLOT_PRIORITY.filter((model) => modelIds.includes(model));
  const remaining = modelIds.filter((model) => !priority.includes(model));
  return unique([selectedModel, ...priority, ...remaining]).slice(0, 16);
}

function buildClaudeEnv(baseUrl, selectedModel, modelIds, proxyApiKey) {
  const slotModels = unique([selectedModel, ...modelIds]).slice(0, CLAUDE_MODEL_SLOT_KEYS.length);
  const env = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: proxyApiKey,
    ANTHROPIC_API_KEY: proxyApiKey,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    ANTHROPIC_MODEL: selectedModel,
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: selectedModel,
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: 'Kiro Gateway model'
  };

  CLAUDE_MODEL_SLOT_KEYS.forEach((key, index) => {
    env[key] = slotModels[index] || selectedModel;
  });

  return env;
}

function buildClaudeArgs(claudeArgs, modelIds, env) {
  const settings = {
    env,
    availableModels: unique([env.ANTHROPIC_MODEL, ...modelIds])
  };
  return ['--settings', JSON.stringify(settings), ...claudeArgs];
}

function printDryRun(baseUrl, selectedModel, visibleModels, env, claudeArgs) {
  const maskedEnv = maskEnvSecrets(env);
  console.log(`gateway: ${baseUrl}`);
  console.log(`model: ${selectedModel}`);
  console.log(`visible models: ${visibleModels.join(', ')}`);
  console.log('env:');
  for (const [key, value] of Object.entries(maskedEnv)) {
    console.log(`  ${key}=${value}`);
  }
  console.log(`claude args: ${JSON.stringify(buildClaudeArgs(claudeArgs, visibleModels, maskedEnv))}`);
}

function maskEnvSecrets(env) {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    key,
    /KEY|TOKEN/i.test(key) ? maskSecret(value) : value
  ]));
}

async function buildGatewayRuntime(gatewayDir, options) {
  const python = await venvPythonCommand(gatewayDir);
  if (!(await pathExists(python.cmd))) {
    throw new Error(`Kiro Gateway venv missing. Run "kiro-cc setup": ${python.cmd}`);
  }

  const dotEnv = await readDotEnv(join(gatewayDir, '.env'));
  if (!dotEnv.PROXY_API_KEY) {
    throw new Error('Kiro Gateway .env is missing PROXY_API_KEY. Run "kiro-cc setup".');
  }
  if (!dotEnv.KIRO_CLI_DB_FILE) {
    dotEnv.KIRO_CLI_DB_FILE = normalizeEnvPath(defaultKiroCliDbPath());
  }

  return {
    python,
    proxyApiKey: dotEnv.PROXY_API_KEY,
    env: {
      ...process.env,
      ...dotEnv,
      PYTHONUNBUFFERED: '1'
    }
  };
}

async function ensureGatewayReady(options) {
  const python = await venvPythonCommand(options.gatewayDir);
  const envPath = join(options.gatewayDir, '.env');
  const env = await readDotEnv(envPath);
  const ready = await pathExists(join(options.gatewayDir, 'main.py'))
    && await pathExists(python.cmd)
    && Boolean(env.PROXY_API_KEY)
    && Boolean(env.KIRO_CLI_DB_FILE);

  if (!ready) {
    await setupGateway({ ...options, update: false });
  }
}

async function startKiroAdapter({ host, port, upstreamBaseUrl, proxyApiKey }) {
  const server = createHttpServer(async (request, response) => {
    try {
      await proxyKiroRequest(request, response, upstreamBaseUrl, proxyApiKey);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `kiro-cc adapter failed: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`
        }
      }));
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolvePromise);
  });

  return { server };
}

async function proxyKiroRequest(request, response, upstreamBaseUrl, proxyApiKey) {
  const incomingUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

  if (incomingUrl.pathname === '/health') {
    const health = await fetch(new URL('/health', upstreamBaseUrl));
    response.writeHead(health.ok ? 200 : 502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: health.ok ? 'healthy' : 'upstream_unhealthy',
      upstream: upstreamBaseUrl
    }));
    return;
  }

  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamBaseUrl);
  const bodyBuffer = await readRequestBody(request);
  let body = bodyBuffer.length > 0 ? bodyBuffer : undefined;
  const headers = buildProxyHeaders(request.headers, proxyApiKey);

  if (request.method === 'POST' && (incomingUrl.pathname === '/v1/messages' || incomingUrl.pathname === '/v1/messages/count_tokens') && bodyBuffer.length > 0) {
    const parsed = JSON.parse(bodyBuffer.toString('utf8'));
    const normalized = normalizeAnthropicBodyForKiro(parsed);
    body = Buffer.from(JSON.stringify(normalized), 'utf8');
    headers['content-length'] = String(body.byteLength);
    headers['content-type'] = headers['content-type'] || 'application/json';
  } else if (bodyBuffer.length > 0) {
    headers['content-length'] = String(bodyBuffer.byteLength);
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body
  });

  response.writeHead(upstream.status, filterResponseHeaders(upstream.headers));
  if (!upstream.body) {
    response.end();
    return;
  }

  for await (const chunk of upstream.body) {
    response.write(Buffer.from(chunk));
  }
  response.end();
}

function normalizeAnthropicBodyForKiro(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
    return body;
  }

  const systemBlocks = [];
  const messages = [];
  for (const message of body.messages) {
    if (message && message.role === 'system') {
      systemBlocks.push(...contentToSystemBlocks(message.content));
    } else {
      messages.push(message);
    }
  }

  if (systemBlocks.length === 0) {
    return body;
  }

  return {
    ...body,
    system: mergeSystemPrompt(body.system, systemBlocks),
    messages
  };
}

function mergeSystemPrompt(existing, extraBlocks) {
  const existingBlocks = contentToSystemBlocks(existing);
  return [...existingBlocks, ...extraBlocks];
}

function contentToSystemBlocks(content) {
  if (!content) {
    return [];
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') {
        return { type: 'text', text: block };
      }
      return block;
    });
  }
  if (typeof content === 'object') {
    return [content];
  }
  return [{ type: 'text', text: String(content) }];
}

function buildProxyHeaders(incomingHeaders, proxyApiKey) {
  const headers = {};
  const skip = new Set([
    'host',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'expect',
    'content-length'
  ]);

  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!skip.has(key.toLowerCase()) && value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  headers.authorization = `Bearer ${proxyApiKey}`;
  headers['x-api-key'] = proxyApiKey;
  return headers;
}

function filterResponseHeaders(headers) {
  const result = {};
  const skip = new Set(['connection', 'keep-alive', 'transfer-encoding']);
  for (const [key, value] of headers.entries()) {
    if (!skip.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function ensureVenv(gatewayDir, python) {
  const venv = await venvPythonCommand(gatewayDir);
  if (!(await pathExists(venv.cmd))) {
    console.error(`kiro-cc: creating Python virtualenv at ${join(gatewayDir, '.venv')}`);
    await runChecked(python.cmd, [...python.args, '-m', 'venv', join(gatewayDir, '.venv')], {
      stdio: 'inherit'
    });
  }
  return venv;
}

async function venvPythonCommand(gatewayDir) {
  if (platform() === 'win32') {
    return { cmd: join(gatewayDir, '.venv', 'Scripts', 'python.exe'), args: [] };
  }
  return { cmd: join(gatewayDir, '.venv', 'bin', 'python'), args: [] };
}

async function resolvePython(options) {
  if (options.python) {
    return { cmd: options.python, args: [] };
  }

  const candidates = platform() === 'win32'
    ? [{ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] }, { cmd: 'python3', args: [] }]
    : [{ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }];

  for (const candidate of candidates) {
    try {
      await execCapture(candidate.cmd, [...candidate.args, '--version'], { timeoutMs: 5000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Python 3 was not found. Install Python 3.10+ or pass --python <path>.');
}

async function resolveKiroCli(options) {
  const candidates = [
    options.kiroCli,
    process.env.KIRO_CLI_BIN,
    defaultKiroCliPath(),
    'kiro-cli',
    'kiro'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execCapture(candidate, ['--version'], { timeoutMs: 8000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Kiro CLI was not found. Install Kiro CLI, or pass --kiro <path>.');
}

function defaultKiroCliPath() {
  if (platform() !== 'win32') {
    return undefined;
  }
  const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(base, 'Kiro-Cli', 'kiro-cli.exe');
}

function defaultKiroCliDbPath() {
  if (platform() === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(base, 'Kiro-Cli', 'data.sqlite3');
  }
  return join(homedir(), '.local', 'share', 'kiro-cli', 'data.sqlite3');
}

async function fetchKiroCliModels(kiroCli) {
  const result = await execCapture(kiroCli, ['chat', '--list-models', '--format', 'json'], {
    timeoutMs: 30000
  });
  const text = result.stdout.trim();
  if (!text) {
    throw new Error('Kiro CLI returned an empty model list.');
  }
  return JSON.parse(text);
}

async function waitForGateway(baseUrl, processHandle, logs) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Kiro Gateway exited early.\n${logs.slice(-20).join('\n')}`);
    }
    try {
      const response = await fetch(new URL('/health', baseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Kiro Gateway at ${baseUrl}.\n${logs.slice(-20).join('\n')}`);
}

async function spawnClaude(command, args, env, gatewayProcess) {
  await new Promise((resolvePromise, reject) => {
    prepareCommand(command, args).then((prepared) => {
      const child = spawn(prepared.command, prepared.args, {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: 'inherit'
      });

      const cleanup = () => killProcess(gatewayProcess);
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);

      child.on('error', (error) => {
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        if (signal) {
          process.kill(process.pid, signal);
          return;
        }
        process.exitCode = code ?? 0;
        resolvePromise();
      });
    }).catch(reject);
  });
}

async function spawnForeground(command, args, options) {
  await new Promise((resolvePromise, reject) => {
    prepareCommand(command, args).then((prepared) => {
      const child = spawn(prepared.command, prepared.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'inherit'
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (signal) {
          process.kill(process.pid, signal);
          return;
        }
        process.exitCode = code ?? 0;
        resolvePromise();
      });
    }).catch(reject);
  });
}

async function runChecked(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    prepareCommand(command, args).then((prepared) => {
      const child = spawn(prepared.command, prepared.args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: options.stdio || 'pipe'
      });
      let stderr = '';
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
      }
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        }
      });
    }).catch(reject);
  });
}

async function execCapture(command, args, options = {}) {
  const prepared = await prepareCommand(command, args);
  return await new Promise((resolvePromise, reject) => {
    execFile(prepared.command, prepared.args, {
      cwd: options.cwd,
      env: options.env || process.env,
      timeout: options.timeoutMs || 10000,
      maxBuffer: 1024 * 1024 * 4
    }, (error, stdout, stderr) => {
      if (error) {
        const message = oneLine(stderr || stdout || error.message);
        reject(new Error(message || error.message));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function prepareCommand(command, args) {
  const resolved = await resolveExecutable(command) || command;
  if (platform() === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', resolved, ...args]
    };
  }
  return { command: resolved, args };
}

async function resolveExecutable(command) {
  if (!command) {
    return undefined;
  }

  if (/[\\/]/.test(command) || /\.[^\\/]+$/.test(command)) {
    return await canExecute(command) ? command : undefined;
  }

  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) {
      continue;
    }
    for (const name of candidateNames(command)) {
      const candidate = join(dir, name);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function candidateNames(binaryName) {
  if (platform() !== 'win32' || /\.[^\\/]+$/.test(binaryName)) {
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
    if (!info.isFile()) {
      return false;
    }
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pickFreePort(host) {
  return await new Promise((resolvePromise, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => {
        if (!port) {
          reject(new Error('Failed to allocate a local port.'));
          return;
        }
        resolvePromise(port);
      });
    });
  });
}

async function waitForever(processHandle, server) {
  await new Promise((resolvePromise, reject) => {
    const cleanup = async () => {
      killProcess(processHandle);
      await closeServer(server).catch(() => {});
      resolvePromise();
    };

    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    processHandle.on('error', async (error) => {
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      await closeServer(server).catch(() => {});
      reject(error);
    });
    processHandle.on('exit', async (code) => {
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      await closeServer(server).catch(() => {});
      process.exitCode = code ?? 0;
      resolvePromise();
    });
  });
}

async function closeServer(server) {
  if (!server || !server.listening) {
    return;
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}

async function assertGatewayInstalled(gatewayDir) {
  if (!(await pathExists(join(gatewayDir, 'main.py')))) {
    throw new Error(`Kiro Gateway is not installed at ${gatewayDir}. Run "kiro-cc setup".`);
  }
}

function captureProcessLog(stream, logs) {
  if (!stream) {
    return;
  }
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        logs.push(line);
      }
    }
    while (logs.length > 200) {
      logs.shift();
    }
  });
}

function killProcess(child) {
  if (child && child.exitCode === null && !child.killed) {
    child.kill();
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readDotEnv(path) {
  const result = {};
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return result;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    result[key] = unquoteDotEnvValue(raw);
  }
  return result;
}

async function writeDotEnv(path, values) {
  await mkdir(dirname(path), { recursive: true });
  const ordered = Object.keys(values).sort();
  const lines = [
    '# Managed by kiro-cc. Do not commit this file.',
    ...ordered.map((key) => `${key}=${quoteDotEnvValue(values[key])}`)
  ];
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

function quoteDotEnvValue(value) {
  return `"${String(value).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

function unquoteDotEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function normalizeEnvPath(path) {
  return path.replace(/\\/g, '/');
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatInteger(value) {
  return Number(value).toLocaleString('en-US');
}

function maskSecret(value) {
  if (!value || value.length <= 8) {
    return value ? '***' : '';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function oneLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
}
