import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ClaudeCliError, buildClaudeCliArgs, buildClaudeCliInput, claudeCliCandidates, claudeCliEnv, createClaudeCliLocator, interpretClaudeCliResult, runClaudeCli, validateClaudeCliPath } from '../desktop/server/claudeCli.mjs';
import { createClaudeStatusHandler, createClaudeTextHandler } from '../desktop/server/claudeText.mjs';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { setWorkspace, LOCAL_AUTH } from '../desktop/server/context.mjs';

// A stand-in for `claude`: never the real CLI. Behaviour is selected by a
// MODE: marker in the prompt read from stdin; it records argv, env and cwd.
const FAKE = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const dir=path.dirname(process.argv[1]),args=process.argv.slice(2);
if(args[0]==='--version'){process.stdout.write(fs.existsSync(path.join(dir,'not-claude'))?'something else\\n':'9.9.9 (Claude Code)\\n');process.exit(0);}
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(dir,'call.json'),JSON.stringify({args,env:process.env,cwd:process.cwd(),cwdFiles:fs.readdirSync(process.cwd()),input,pid:process.pid}));
 const mode=(input.match(/MODE:(\\w+)/)||[])[1]||'ok';
 const out=e=>process.stdout.write(JSON.stringify(e)+'\\n');
 out({type:'system',subtype:'init',apiKeySource:mode==='apikey'?'ANTHROPIC_API_KEY':'none',tools:[]});
 const done=(extra)=>out({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',duration_ms:12,session_id:'s-1',usage:{input_tokens:3,output_tokens:4},...extra});
 if(mode==='ok')return done({result:'Enhanced prompt.'});
 if(mode==='schema'){const s=JSON.parse(args[args.indexOf('--json-schema')+1]);return done({result:'{}',structured_output:{ideas:Object.fromEntries(s.properties.ideas.required.map((k,i)=>[k,'Idea '+(i+1)]))}});}
 if(mode==='login')return out({type:'result',subtype:'success',is_error:true,terminal_reason:'api_error',result:'Not logged in · Please run /login'});
 if(mode==='limit'){out({type:'rate_limit_event',rate_limit_info:{status:'rejected',resetsAt:1793138400}});return out({type:'result',subtype:'success',is_error:true,result:"You've hit your limit"});}
 if(mode==='crash'){process.stderr.write('boom: internal failure\\n');process.exit(3);}
 if(mode==='flood'){const big='x'.repeat(65536);const loop=()=>{while(process.stdout.write(big));process.stdout.once('drain',loop);};return loop();}
 if(mode==='hang'||mode==='apikey')return setInterval(()=>{},1000);
});
`;
const makeFake = (home = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-fake-claude-'))) => {
  const bin = path.join(home, '.local/bin'); fs.mkdirSync(bin, { recursive: true });
  const cli = path.join(bin, 'claude'); fs.writeFileSync(cli, FAKE, { mode: 0o755 });
  return { home, cli, call: () => JSON.parse(fs.readFileSync(path.join(bin, 'call.json'), 'utf8')), cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
};
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check, ms = 5_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 25)); } return true; };
const prompt = text => buildClaudeCliInput([{ text }]);
// The fake CLI is a POSIX shebang script; Claude (abonelik) is a Mac-only provider.
const POSIX_ONLY = { skip: process.platform === 'win32' && 'fake CLI needs a POSIX shebang' };
const ARGS = buildClaudeCliArgs({ model: 'anthropic/claude-opus-5.5', effort: 'medium', system: 'System.' });

test('arguments: print mode, stream JSON, mapped model/effort, no tools, MCP, hooks or saved session; prompt stays out of argv', () => {
  const args = buildClaudeCliArgs({ model: 'anthropic/claude-opus-5.5', effort: 'xhigh', system: 'Fixed instructions.', schema: { type: 'object' } });
  for (const flag of ['-p', '--verbose', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  const value = flag => args[args.indexOf(flag) + 1];
  assert.equal(value('--input-format'), 'stream-json'); assert.equal(value('--output-format'), 'stream-json');
  assert.equal(value('--model'), 'claude-opus-5-5'); assert.equal(value('--effort'), 'xhigh');
  assert.equal(value('--tools'), ''); assert.equal(value('--permission-prompts'), 'none');
  assert.equal(value('--json-schema'), '{"type":"object"}');
  for (const forbidden of ['--bare', '--fallback-model', '--dangerously-skip-permissions', '--allowedTools', '--add-dir', '--resume', '--continue']) assert.ok(!args.includes(forbidden), forbidden);
  assert.ok(!buildClaudeCliArgs({ model: 'anthropic/claude-opus-5.5', effort: 'low', system: 'S' }).includes('--json-schema'));
  assert.throws(() => buildClaudeCliArgs({ model: 'gpt-6.1-sol', effort: 'low', system: 'S' }), /model/);
  assert.throws(() => buildClaudeCliArgs({ model: 'anthropic/claude-opus-5.5', effort: 'ultra', system: 'S' }), /effort/);
});

test('stdin input carries text and base64 image blocks; blank text parts are dropped', () => {
  const line = buildClaudeCliInput([{ text: 'Brief' }, { text: '  ' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }]);
  assert.ok(line.endsWith('\n'));
  const message = JSON.parse(line);
  assert.equal(message.type, 'user');
  assert.deepEqual(message.message.content, [{ type: 'text', text: 'Brief' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
});

test('child environment is built from scratch: USER and HOME for the Keychain login, never provider keys', () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'sk-test-not-forwarded'; process.env.ANTHROPIC_API_KEY = 'sk-ant-not-forwarded';
  try {
    const env = claudeCliEnv('/Users/example/.local/bin/claude', { home: '/Users/example', user: 'test', tmp: '/tmp' });
    assert.deepEqual(Object.keys(env).sort(), ['DISABLE_AUTOUPDATER', 'HOME', 'LANG', 'PATH', 'TMPDIR', 'USER']);
    assert.equal(env.USER, 'test'); assert.equal(env.HOME, '/Users/example');
    assert.ok(env.PATH.startsWith('/Users/example/.local/bin:'));
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; delete process.env.ANTHROPIC_API_KEY; }
});

test('result parsing: structured output, login, usage limit, API-key billing and generic failures are distinct', () => {
  const ok = interpretClaudeCliResult({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: '{}', structured_output: { ideas: ['a'] }, session_id: 's' });
  assert.equal(ok.text, '{"ideas":["a"]}');
  assert.equal(interpretClaudeCliResult({ subtype: 'success', is_error: false, result: 'Plain' }).text, 'Plain');
  const code = value => value instanceof ClaudeCliError ? value.code : 'ok';
  assert.equal(code(interpretClaudeCliResult({ subtype: 'success', is_error: false, result: '  ' })), 'empty');
  assert.equal(code(interpretClaudeCliResult({ subtype: 'success', is_error: false, terminal_reason: 'max_turns', result: 'x' })), 'failed');
  assert.equal(code(interpretClaudeCliResult({ is_error: true, result: 'Not logged in · Please run /login' })), 'not_logged_in');
  const limit = interpretClaudeCliResult({ is_error: true, result: 'Request failed' }, { rateLimit: { status: 'rejected', resetsAt: 1793138400 } });
  assert.equal(code(limit), 'usage_limit'); assert.match(limit.message, /kullanım limit/);
  assert.equal(code(interpretClaudeCliResult({ is_error: true, result: 'Claude AI usage limit reached|1793138400' })), 'usage_limit');
  assert.equal(code(interpretClaudeCliResult({ subtype: 'success', is_error: false, result: 'x' }, { apiKeySource: 'ANTHROPIC_API_KEY' })), 'api_key');
  assert.equal(code(interpretClaudeCliResult(null)), 'failed');
  assert.match(interpretClaudeCliResult({ is_error: true, result: 'Overloaded' }).message, /Overloaded/);
});

test('fake CLI run: prompt via stdin, empty private working directory removed afterwards, minimal env', POSIX_ONLY, async () => {
  const fake = makeFake();
  try {
    process.env.OPENROUTER_API_KEY = 'sk-or-not-forwarded';
    const output = await runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt('Secret brief MODE:ok'), home: fake.home });
    assert.equal(output.text, 'Enhanced prompt.'); assert.equal(output.sessionId, 's-1');
    const call = fake.call();
    assert.ok(!call.args.some(arg => arg.includes('Secret brief')));
    assert.match(call.input, /Secret brief/);
    assert.deepEqual(call.cwdFiles, []); assert.ok(path.basename(call.cwd).startsWith('banana-claude-')); assert.ok(!fs.existsSync(call.cwd));
    assert.equal(call.env.OPENROUTER_API_KEY, undefined); assert.equal(call.env.HOME, fake.home); assert.ok(call.env.USER);
  } finally { delete process.env.OPENROUTER_API_KEY; fake.cleanup(); }
});

test('fake CLI errors: login, usage limit, crash with stderr, missing binary', POSIX_ONLY, async () => {
  const fake = makeFake();
  try {
    const run = mode => runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt(`MODE:${mode}`), home: fake.home }).then(() => 'ok', error => error);
    assert.equal((await run('login')).code, 'not_logged_in');
    assert.equal((await run('limit')).code, 'usage_limit');
    const crash = await run('crash'); assert.equal(crash.code, 'failed'); assert.match(crash.message, /çıkış 3.*boom/);
    const missing = await runClaudeCli({ cliPath: path.join(fake.home, 'missing/claude'), args: ARGS, input: prompt('x') }).catch(error => error);
    assert.equal(missing.code, 'not_found');
  } finally { fake.cleanup(); }
});

test('timeout, caller abort, output overflow and API-key login kill the child', POSIX_ONLY, async () => {
  const fake = makeFake();
  try {
    const timeout = await runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt('MODE:hang'), timeoutMs: 400, killGraceMs: 200, home: fake.home }).catch(error => error);
    assert.equal(timeout.code, 'timeout');
    assert.ok(await waitFor(() => !alive(fake.call().pid)), 'timed-out child still running');
    const controller = new AbortController();
    const aborted = runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt('MODE:hang'), signal: controller.signal, killGraceMs: 200, home: fake.home }).catch(error => error);
    await waitFor(() => { try { return fake.call().input.includes('MODE:hang') && alive(fake.call().pid); } catch { return false; } });
    setTimeout(() => controller.abort(), 100);
    assert.equal((await aborted).code, 'aborted');
    assert.ok(await waitFor(() => !alive(fake.call().pid)));
    const flood = await runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt('MODE:flood'), maxOutputBytes: 256 * 1024, killGraceMs: 200, home: fake.home }).catch(error => error);
    assert.equal(flood.code, 'output_limit');
    const apiKey = await runClaudeCli({ cliPath: fake.cli, args: ARGS, input: prompt('MODE:apikey'), killGraceMs: 200, home: fake.home }).catch(error => error);
    assert.equal(apiKey.code, 'api_key');
    assert.ok(await waitFor(() => !alive(fake.call().pid)));
  } finally { fake.cleanup(); }
});

test('discovery: common locations, verified version, explicit path is authoritative', POSIX_ONLY, async () => {
  const fake = makeFake();
  try {
    assert.ok(claudeCliCandidates({ home: '/Users/example' }).includes('/opt/homebrew/bin/claude'));
    assert.deepEqual(claudeCliCandidates({ home: '/Users/example', configured: '/custom/claude' }), ['/custom/claude']);
    let configured = null;
    const locator = createClaudeCliLocator({ home: fake.home, getConfigured: () => configured });
    const found = await locator.refresh();
    assert.deepEqual(found, { available: true, path: fake.cli, version: '9.9.9', source: 'discovered' });
    configured = path.join(fake.home, 'elsewhere/claude');
    const broken = await locator.refresh();
    assert.equal(broken.available, false); assert.equal(broken.configuredPath, configured);
    configured = null; fs.writeFileSync(path.join(path.dirname(fake.cli), 'not-claude'), '');
    fs.utimesSync(fake.cli, new Date(), new Date(Date.now() + 5_000));
    assert.equal((await locator.refresh()).available, false);
    for (const bad of ['relative/claude', '/usr/bin/python3', 'C:\\claude', 42]) assert.throws(() => validateClaudeCliPath(bad));
    assert.equal(validateClaudeCliPath(''), null); assert.equal(validateClaudeCliPath('/opt/x/../homebrew/bin/claude'), '/opt/homebrew/bin/claude');
  } finally { fake.cleanup(); }
});

// Minimal req/res pair for the desktop route contract.
const call = async (handler, body, { accept = 'application/x-ndjson', method = 'POST' } = {}) => {
  const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, chunks: [], writableEnded: false, destroyed: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.writableEnded = true; return this; }, write(chunk) { this.chunks.push(chunk); },
    end() { this.writableEnded = true; this.emit('close'); }, off(...args) { return this.removeListener(...args); } });
  await handler({ method, body, headers: { accept }, [LOCAL_AUTH]: true }, res);
  const events = res.chunks.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { res, events, terminal: events.at(-1) };
};
const textBody = (extra = {}) => ({ model: 'anthropic/claude-opus-5.5', reasoningEffort: 'medium', contents: { parts: [{ text: 'Brief MODE:ok' }] }, usageContext: { action: 'enhance', prompt: 'Brief' }, ...extra });

test('desktop route keeps the existing text contract, records zero-cost usage and maps errors', POSIX_ONLY, async () => {
  const fake = makeFake(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-claude-ws-'));
  const store = new LocalWorkspace(directory); setWorkspace(store);
  try {
    const locator = { refresh: async () => ({ available: true, path: fake.cli }) };
    const handler = createClaudeTextHandler({ locator, run: options => runClaudeCli({ ...options, home: fake.home }) });
    let { terminal } = await call(handler, textBody());
    assert.equal(terminal.type, 'result');
    assert.equal(terminal.result.text, 'Enhanced prompt.'); assert.equal(terminal.result.provider, 'claude-cli');
    assert.equal(terminal.result.usageMetadata.usageLogged, true); assert.equal(terminal.result.usageMetadata.openrouterUsage, undefined);
    const logs = (await store.client(true).from('usage_logs').select('*')).data;
    assert.equal(logs.at(-1).estimated_cost, 0); assert.equal(logs.at(-1).model, 'anthropic/claude-opus-5.5');

    ({ terminal } = await call(handler, textBody({ contents: { parts: [{ text: 'MODE:schema three ideas' }] }, usageContext: { action: 'brainstorm', prompt: 'b' }, brainstormCount: 3 })));
    assert.deepEqual(JSON.parse(terminal.result.text), ['Idea 1', 'Idea 2', 'Idea 3']);
    assert.ok(fake.call().args.includes('--json-schema'));

    ({ terminal } = await call(handler, textBody({ contents: { parts: [{ text: 'MODE:login' }] } })));
    assert.equal(terminal.type, 'error'); assert.match(terminal.error, /\/login/);
    const json = await call(handler, textBody({ contents: { parts: [{ text: 'MODE:limit' }] } }), { accept: 'application/json' });
    assert.equal(json.res.statusCode, 429); assert.match(json.res.body.error, /limit/);

    const youtube = await call(handler, textBody({ contents: { parts: [{ text: 'x' }, { fileData: { fileUri: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' } }] } }));
    assert.equal(youtube.res.statusCode, 400);
    assert.equal((await call(handler, textBody({ model: 'gpt-6.1-sol' }))).res.statusCode, 400);
    const missing = await call(createClaudeTextHandler({ locator: { refresh: async () => ({ available: false, error: 'Claude CLI bulunamadı.' }) } }), textBody());
    assert.equal(missing.res.statusCode, 503); assert.match(missing.res.body.error, /bulunamadı/);

    let saved;
    const status = createClaudeStatusHandler({ locator, saveConfigured: value => { saved = value; } });
    assert.equal((await call(status, { path: 'relative' }, { accept: '' })).res.statusCode, 400);
    assert.equal((await call(status, { path: '/opt/homebrew/bin/claude' }, { accept: '' })).res.body.available, true);
    assert.equal(saved, '/opt/homebrew/bin/claude');
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); fake.cleanup(); }
});
