// Desktop-only text route through the user's own, already logged-in Claude
// Code CLI. The CLI owns authentication: this module never reads, copies or
// forwards Claude credentials, and the child gets a minimal environment so a
// provider API key in this process can never switch the request to API billing.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_CLI_MODELS = { 'anthropic/claude-opus-5.5': 'claude-opus-5-5' };
export const CLAUDE_CLI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_CLI_TIMEOUT_MS = 240_000;
export const CLAUDE_CLI_MAX_OUTPUT = 8 * 1024 * 1024;

export class ClaudeCliError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'ClaudeCliError'; this.code = code; Object.assign(this, extra); }
}

const loginHint = 'Claude CLI oturumu açık değil. Terminalde `claude` çalıştırıp /login ile aboneliğinle giriş yap, sonra yeniden dene.';
const notFoundHint = 'Claude CLI bulunamadı. Claude Code\'u kur (~/.local/bin/claude) veya AI ayarlarında CLI yolunu gir.';

const userName = () => { try { return os.userInfo().username; } catch { return process.env.USER || ''; } };

/** USER is required: without it the CLI cannot find its Keychain login and
 * reports "Not logged in" (verified with `env -i`). Nothing else is inherited. */
export function claudeCliEnv(cliPath, { home = os.homedir(), user = userName(), tmp = os.tmpdir() } = {}) {
  return {
    PATH: [path.dirname(cliPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: home, USER: user, TMPDIR: tmp, LANG: 'en_US.UTF-8', DISABLE_AUTOUPDATER: '1',
  };
}

export function claudeCliCandidates({ configured, home = os.homedir() } = {}) {
  // An explicit path is authoritative: a broken setting must be reported, not
  // silently replaced by another installation.
  if (configured) return [configured];
  const list = [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
    path.join(home, '.claude/local/claude'), path.join(home, '.npm-global/bin/claude'), path.join(home, '.volta/bin/claude'), path.join(home, '.bun/bin/claude')];
  const nvm = path.join(home, '.nvm/versions/node');
  try { for (const version of fs.readdirSync(nvm).sort().reverse()) list.push(path.join(nvm, version, 'bin/claude')); } catch { /* nvm is optional */ }
  return list;
}

const executable = file => {
  try { if (!fs.statSync(file).isFile()) return false; fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
};

export const validateClaudeCliPath = value => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1024 || !path.isAbsolute(value) || value.includes('\0')) throw new Error('CLI yolu mutlak bir dosya yolu olmalı.');
  if (path.basename(value) !== 'claude') throw new Error('CLI yolu `claude` adlı çalıştırılabilir dosyayı göstermeli.');
  return path.normalize(value);
};

const readVersion = (file, home, timeout = 15_000) => new Promise(resolve => {
  execFile(file, ['--version'], { env: claudeCliEnv(file, { home }), cwd: os.tmpdir(), timeout, maxBuffer: 64 * 1024 }, (error, stdout) => {
    const match = !error && String(stdout).match(/(\d+\.\d+\.\d+)\s*\(Claude Code\)/);
    resolve(match ? match[1] : null);
  });
});

/** Finds and verifies the CLI. `--version` runs once per path/mtime. */
export function createClaudeCliLocator({ getConfigured = () => null, home = os.homedir() } = {}) {
  let cache = new Map(), current = { available: false };
  const locate = async () => {
    const configured = getConfigured();
    for (const candidate of claudeCliCandidates({ configured, home })) {
      if (!executable(candidate)) continue;
      const key = `${candidate}:${fs.statSync(candidate).mtimeMs}`;
      if (!cache.has(key)) cache.set(key, await readVersion(candidate, home));
      const version = cache.get(key);
      if (version) return { available: true, path: candidate, version, source: configured ? 'configured' : 'discovered' };
      if (configured) return { available: false, configuredPath: configured, error: 'Ayarlanan dosya Claude Code CLI gibi yanıt vermedi (`claude --version`).' };
    }
    return configured ? { available: false, configuredPath: configured, error: 'Ayarlanan CLI yolunda çalıştırılabilir dosya yok.' }
      : { available: false, error: notFoundHint };
  };
  return {
    async refresh() { current = await locate(); return current; },
    get current() { return current; },
  };
}

/** Text and JPEG/PNG/WebP parts become one Claude user message on stdin, so
 * neither the prompt nor references appear in argv and no file tool is needed. */
export function buildClaudeCliInput(parts) {
  const content = [];
  for (const part of parts) {
    if (typeof part?.text === 'string') { if (part.text.trim()) content.push({ type: 'text', text: part.text }); }
    else if (part?.inlineData) content.push({ type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data } });
  }
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' }) + '\n';
}

export function buildClaudeCliArgs({ model, effort, system, schema }) {
  const cliModel = CLAUDE_CLI_MODELS[model];
  if (!cliModel) throw new Error('Unsupported Claude CLI model.');
  if (!CLAUDE_CLI_EFFORTS.includes(effort)) throw new Error('Unsupported Claude CLI effort.');
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', cliModel, '--effort', effort,
    // No built-in tools, MCP servers, hooks, CLAUDE.md, slash commands,
    // permission prompts or saved transcript. No --fallback-model either:
    // the request runs on the selected model or fails visibly.
    '--tools', '', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--permission-prompts', 'none', '--no-session-persistence',
    '--system-prompt', system, ...(schema ? ['--json-schema', JSON.stringify(schema)] : [])];
}

const usageLimitMessage = rateLimit => {
  const reset = Number(rateLimit?.resetsAt);
  const when = Number.isFinite(reset) && reset > 0 ? ` Limit ${new Date(reset * 1000).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} civarında sıfırlanır.` : '';
  return `Claude abonelik kullanım limitine ulaşıldı.${when} AI ayarlarında başka bir sağlayıcı seçebilirsin.`;
};

/** Maps the CLI's terminal `result` event to text or a typed, user-facing error. */
export function interpretClaudeCliResult(result, { rateLimit, apiKeySource } = {}) {
  if (apiKeySource && /api.?key/i.test(apiKeySource)) return new ClaudeCliError('api_key', 'Claude CLI abonelik yerine bir API anahtarı kullanıyor; istek iptal edildi. CLI ayarlarındaki API anahtarını kaldır.');
  if (!result) return new ClaudeCliError('failed', 'Claude CLI yanıt vermeden kapandı. Yeniden dene.');
  if (result.is_error === false && result.subtype === 'success' && (result.terminal_reason == null || result.terminal_reason === 'completed')) {
    const text = result.structured_output !== undefined ? JSON.stringify(result.structured_output) : typeof result.result === 'string' ? result.result : '';
    if (!text.trim()) return new ClaudeCliError('empty', 'Claude boş yanıt döndürdü. Yeniden dene.');
    return { text, usage: result.usage ?? null, durationMs: result.duration_ms ?? null, sessionId: result.session_id ?? null };
  }
  const message = [result.result, ...(Array.isArray(result.errors) ? result.errors : [])].filter(value => typeof value === 'string').join(' ');
  if (/not logged in|\/login|please log ?in|oauth token|authentication_error/i.test(message)) return new ClaudeCliError('not_logged_in', loginHint);
  if (rateLimit?.status === 'rejected' || /usage limit|hit your limit|limit reached|rate.?limit|out of (extra )?usage/i.test(message)) return new ClaudeCliError('usage_limit', usageLimitMessage(rateLimit));
  if (result.subtype === 'error_max_structured_output_retries') return new ClaudeCliError('format', 'Claude yanıtı beklenen biçime uymadı. Yeniden dene.');
  return new ClaudeCliError('failed', `Claude CLI isteği tamamlanamadı${message ? `: ${message.replace(/\s+/g, ' ').slice(0, 240)}` : '.'}`);
}

/** Runs one print-mode request in a fresh empty directory and always removes
 * it. The child is killed on timeout, caller abort or oversized output. */
export function runClaudeCli({ cliPath, args, input, timeoutMs = CLAUDE_CLI_TIMEOUT_MS, maxOutputBytes = CLAUDE_CLI_MAX_OUTPUT, signal, home, killGraceMs = 3_000, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ClaudeCliError('aborted', 'İstek iptal edildi.'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-'));
    let child;
    try { child = spawnImpl(cliPath, args, { cwd, env: claudeCliEnv(cliPath, home ? { home } : {}), stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { fs.rmSync(cwd, { recursive: true, force: true }); return reject(new ClaudeCliError('not_found', notFoundHint, { cause: error })); }
    let buffer = '', bytes = 0, stderr = '', result, rateLimit, apiKeySource, failure, settled = false, killTimer;
    const stop = error => {
      if (failure) return; failure = error;
      child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs); killTimer.unref?.();
    };
    const timer = setTimeout(() => stop(new ClaudeCliError('timeout', `Claude CLI ${Math.round(timeoutMs / 1000)} sn içinde yanıt vermedi; işlem durduruldu. İsteği kısaltıp yeniden dene.`)), timeoutMs);
    const onAbort = () => stop(new ClaudeCliError('aborted', 'İstek iptal edildi.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const line = text => {
      if (!text.trim()) return;
      let event; try { event = JSON.parse(text); } catch { return; }
      if (event?.type === 'result') result = event;
      else if (event?.type === 'rate_limit_event') rateLimit = event.rate_limit_info;
      else if (event?.type === 'system' && event.subtype === 'init') {
        apiKeySource = event.apiKeySource;
        if (apiKeySource && /api.?key/i.test(apiKeySource)) stop(interpretClaudeCliResult(null, { apiKeySource }));
      }
    };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) return stop(new ClaudeCliError('output_limit', 'Claude CLI çıktısı izin verilen boyutu aştı; işlem durduruldu.'));
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n'); buffer = lines.pop();
      lines.forEach(line);
    });
    child.stderr.on('data', chunk => { if (stderr.length < 16_384) stderr += chunk.toString('utf8'); });
    child.stdin.on('error', () => { /* Reported through exit status. */ });
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort);
      fs.rmSync(cwd, { recursive: true, force: true });
      error ? reject(error) : resolve(value);
    };
    child.on('error', error => finish(error.code === 'ENOENT' || error.code === 'EACCES' ? new ClaudeCliError('not_found', notFoundHint) : new ClaudeCliError('failed', 'Claude CLI başlatılamadı.')));
    child.on('close', code => {
      if (failure) return finish(failure);
      line(buffer);
      const outcome = interpretClaudeCliResult(result, { rateLimit, apiKeySource });
      if (outcome instanceof ClaudeCliError) {
        if (!result && code !== 0) {
          const detail = stderr.trim().split('\n').pop()?.slice(0, 240);
          if (/not logged in|\/login/i.test(stderr)) return finish(new ClaudeCliError('not_logged_in', loginHint));
          return finish(new ClaudeCliError('failed', `Claude CLI hata ile kapandı (çıkış ${code})${detail ? `: ${detail}` : '.'}`));
        }
        return finish(outcome);
      }
      finish(null, { ...outcome, rateLimit: rateLimit ?? null });
    });
    child.stdin.end(input);
  });
}
