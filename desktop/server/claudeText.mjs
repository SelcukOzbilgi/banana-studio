// Desktop-only twin of api/openrouter-text-generate.ts. Same request
// validation, NDJSON events and result shape; the provider is the local
// Claude Code CLI on the user's own subscription (no API key, no API cost).
import { createUserScopedClient, requireUser } from './auth.mjs';
import { startOpenAIRequest } from './guard.mjs';
import { buildBrainstormOutputFormat, brainstormOutputInstruction, isBrainstormCount, YOUTUBE_ANALYSIS_FORMAT, normalizeBrainstormOutput } from '../../api/_lib/textOutputFormats.ts';
import { CLAUDE_CLI_EFFORTS, CLAUDE_CLI_MODELS, ClaudeCliError, buildClaudeCliArgs, buildClaudeCliInput, runClaudeCli, validateClaudeCliPath } from './claudeCli.mjs';

const ACTIONS = ['enhance', 'video_enhance', 'brainstorm', 'variation'];
const STATUS = { not_found: 503, not_logged_in: 401, usage_limit: 429, timeout: 504, aborted: 499, api_key: 409 };

export function createClaudeTextHandler({ locator, run = runClaudeCli, timeoutMs } = {}) {
  return async function claudeCliTextGenerate(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const started = Date.now();
    const user = await requireUser(req, res);
    if (!user) return;
    const body = req.body, parts = body?.contents?.parts, usageContext = body?.usageContext;
    if (!CLAUDE_CLI_MODELS[body?.model]) return res.status(400).json({ error: 'Claude (abonelik) yalnız Claude Opus 5.5 metin modelini çalıştırır.' });
    const effort = body.reasoningEffort ?? 'medium';
    if (!CLAUDE_CLI_EFFORTS.includes(effort)) return res.status(400).json({ error: 'Unsupported Opus thinking effort.' });
    if (!ACTIONS.includes(usageContext?.action) || typeof usageContext?.prompt !== 'string') return res.status(400).json({ error: 'Invalid text feature.' });
    if (!Array.isArray(parts) || !parts.length || parts.length > 256 || !parts.some(part => typeof part?.text === 'string' && part.text.trim())) {
      return res.status(400).json({ error: 'Provide text and optional image references.' });
    }
    if (body.brainstormFormat != null && (body.brainstormFormat !== 'wardrobe' || usageContext.action !== 'brainstorm')) return res.status(400).json({ error: 'Invalid Brainstorm output format.' });
    if (body.brainstormCount != null && (usageContext.action !== 'brainstorm' || !isBrainstormCount(body.brainstormCount))) return res.status(400).json({ error: 'Invalid Brainstorm idea count.' });
    if (body.outputFormat != null && (body.outputFormat !== 'youtube_analysis' || usageContext.action !== 'enhance' || body.brainstormFormat != null)) return res.status(400).json({ error: 'Invalid analysis output format.' });
    if (Buffer.byteLength(JSON.stringify(parts), 'utf8') > 4_100_000) return res.status(413).json({ error: 'Reference images are too large. Use fewer or smaller images.' });
    for (const part of parts) {
      const text = typeof part?.text === 'string' && !part.inlineData && !part.fileData;
      const image = part?.text == null && !part?.fileData && ['image/jpeg', 'image/png', 'image/webp'].includes(part?.inlineData?.mimeType)
        && typeof part.inlineData.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(part.inlineData.data);
      if (!text && !image) return res.status(400).json({ error: 'Claude (abonelik) metin ve JPEG, PNG, WebP referans kabul eder. YouTube görüntüsü için Gemini gerekir.' });
    }
    const cli = await locator.refresh();
    if (!cli.available) return res.status(503).json({ error: cli.error || 'Claude CLI bulunamadı.' });

    const guard = await startOpenAIRequest(req, res, user, 'text');
    if (!guard) return;
    const streaming = String(req.headers?.accept || '').includes('application/x-ndjson');
    const abort = new AbortController();
    let heartbeat, sessionId = null, outcome = 'failed';
    const send = event => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    // A closed browser request stops the CLI instead of finishing unseen work.
    const close = () => { clearInterval(heartbeat); if (!res.writableEnded) abort.abort(); };
    res.on('close', close);
    const fail = async (status, error) => {
      console.warn(`[claude-cli-text] action=${usageContext.action} status=${status} ms=${Date.now() - started}`);
      await guard.finish('failed', sessionId, status);
      if (streaming) { send({ type: 'error', error }); return res.end(); }
      return res.status(status).json({ error });
    };
    if (streaming) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no');
      send({ type: 'status', stage: 'generating' });
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
    }
    const wardrobe = body.brainstormFormat === 'wardrobe';
    const analysis = body.outputFormat === 'youtube_analysis';
    const format = analysis ? YOUTUBE_ANALYSIS_FORMAT : usageContext.action === 'brainstorm' ? buildBrainstormOutputFormat(wardrobe, body.brainstormCount) : undefined;
    const system = analysis
      ? 'Prepare the requested factual episode analysis using only the supplied footage or verified observations. Report unavailable footage honestly; never invent events, identities, prices, outcomes or timestamps. Return exactly the requested JSON object.'
      : 'Complete the requested prompt-writing task using the supplied brief and references. Make reasonable creative decisions without follow-up questions. Return only the finished deliverable, without preamble or commentary.' + (usageContext.action === 'brainstorm' ? brainstormOutputInstruction(wardrobe, body.brainstormCount) : '');
    try {
      const output = await run({ cliPath: cli.path, args: buildClaudeCliArgs({ model: body.model, effort, system, schema: format?.schema }), input: buildClaudeCliInput(parts), signal: abort.signal, ...(timeoutMs ? { timeoutMs } : {}) });
      sessionId = output.sessionId;
      if (streaming) send({ type: 'status', stage: 'finishing' });
      let text = output.text;
      if (usageContext.action === 'brainstorm') {
        const normalized = normalizeBrainstormOutput(text, wardrobe, body.brainstormCount);
        if (!normalized) return fail(502, 'Claude fikirleri beklenen biçimde döndürmedi. Yeniden dene.');
        text = normalized;
      }
      if (analysis) {
        let value; try { value = JSON.parse(text); } catch { /* checked below */ }
        if (typeof value?.videoAvailable !== 'boolean' || typeof value.brief !== 'string' || typeof value.premise !== 'string'
          || typeof value.limitation !== 'string' || !Array.isArray(value.evidence)) return fail(502, 'Claude video analizini beklenen biçimde döndürmedi.');
      }
      // Subscription usage has no per-request price. Record it at zero so the
      // browser does not estimate an OpenRouter cost for the same model.
      let usageLogged = false, usageLoggingPending = false;
      try {
        const { error } = await createUserScopedClient(req).from('usage_logs').insert({
          user_id: user.id, action: usageContext.action, model: body.model, prompt: usageContext.prompt.slice(0, 500), image_count: 0, estimated_cost: 0,
        });
        usageLogged = !error;
      } catch { usageLoggingPending = true; }
      const result = { text, candidates: null, provider: 'claude-cli', providerModel: `${CLAUDE_CLI_MODELS[body.model]} · Claude Code CLI`,
        usageMetadata: { provider: 'claude-cli', claudeCliUsage: output.usage, durationMs: output.durationMs, usageLogged, usageLoggingPending }, requestId: guard.id };
      outcome = 'completed'; await guard.finish('completed', sessionId, 200);
      console.info(`[claude-cli-text] action=${usageContext.action} effort=${effort} ms=${Date.now() - started}`);
      if (streaming) { send({ type: 'result', result }); return res.end(); }
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ClaudeCliError) return fail(STATUS[error.code] || 502, error.message);
      return fail(502, 'Claude CLI isteği tamamlanamadı. Yeniden dene.');
    } finally {
      clearInterval(heartbeat); res.off?.('close', close);
      await guard.finish(outcome, sessionId);
    }
  };
}

/** GET reports whether the CLI was found; POST {path} saves an explicit path
 * (or null to return to automatic discovery). Nothing here reads credentials. */
export function createClaudeStatusHandler({ locator, saveConfigured }) {
  return async function claudeCliStatus(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!await requireUser(req, res)) return;
    if (req.method === 'POST') {
      let value;
      try { value = validateClaudeCliPath(req.body?.path); } catch (error) { return res.status(400).json({ error: error.message }); }
      saveConfigured(value);
    } else if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    return res.status(200).json(await locator.refresh());
  };
}
