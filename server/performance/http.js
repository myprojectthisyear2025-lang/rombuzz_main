/** Path: server/performance/http.js
 * Purpose: Request IDs, header/finish boundaries, serialization and one bounded diagnostic record. */
const { randomUUID } = require('node:crypto');
const { storage, enabled, rate, now, begin, union } = require('./context');
const Sentry = require('@sentry/node');
const { runtimeStart, runtimeEnd } = require('./runtime');
function requestTiming(req, res, next) {
  if (!enabled || Math.random() >= rate) return next();
  const ctx = { id: randomUUID(), start: now(), spans: [], open: new Set(), dropped: 0, closed: false };
  const runtime = runtimeStart();
  storage.run(ctx, () => {
    const activeSpan = Sentry.getActiveSpan();
    if (activeSpan) {
      ctx.traceId = activeSpan.spanContext().traceId;
      activeSpan.setAttribute('rombuzz.perf.request_id', ctx.id);
    }
    res.setHeader('X-Perf-Request-Id', ctx.id);
    // The template is set by the route wrapper; never log actual paths/query strings.
    ctx.route = 'unmatched';
    let stopJson;
    const json = res.json, send = res.send, writeHead = res.writeHead;
    res.json = function (...args) {
      stopJson = begin('json.stringify', 'serialize', ctx);
      try { return json.apply(this, args); } finally { stopJson(); stopJson = null; }
    };
    res.send = function (...args) {
      if (stopJson) stopJson();
      return send.apply(this, args);
    };
    res.writeHead = function (...args) {
      if (ctx.headersMs === undefined) {
        if (stopJson) stopJson();
        for (const stop of [...ctx.open]) stop();
        // Existing fire-and-forget work after res.json is outside the response critical path.
        ctx.closed = true;
        ctx.headersMs = now() - ctx.start;
        ctx.runtime = runtimeEnd(runtime);
        const values = ['auth', 'middleware', 'mongo', 'hydrate', 'logic', 'serialize']
          .map(c => `${c};dur=${union(ctx.spans, c, ctx.headersMs).toFixed(3)}`);
        values.push(`total;dur=${ctx.headersMs.toFixed(3)}`);
        const previous = res.getHeader('Server-Timing');
        res.setHeader('Server-Timing', [...(previous ? [previous] : []), ...values].join(', '));
      }
      return writeHead.apply(this, args);
    };
    let finished = false;
    const finish = (aborted) => {
      if (finished) return;
      finished = true;
      for (const stop of [...ctx.open]) stop();
      ctx.closed = true;
      const record = {
        kind: 'http', requestId: ctx.id, traceId: ctx.traceId, method: req.method, route: ctx.route,
        status: res.statusCode, aborted, headersMs: ctx.headersMs ?? null, runtime: ctx.runtime,
        finishMs: now() - ctx.start, mongoUnionMs: union(ctx.spans, 'mongo'),
        mongoSumMs: ctx.spans.filter(s => s.category === 'mongo').reduce((a, s) => a + s.durationMs, 0),
        queryCount: ctx.spans.filter(s => s.category === 'mongo').length,
        commandCount: ctx.spans.filter(s => s.category === 'mongo-command').length,
        responseBytes: Number(res.getHeader('content-length')) || null,
        droppedSpans: ctx.dropped, spans: ctx.spans,
      };
      // No request/response bodies, headers, filters, URLs, user or socket identifiers.
      try { console.log('[PERF] ' + JSON.stringify(record)); } catch { /* diagnostics cannot fail requests */ }
    };
    res.once('finish', () => finish(false));
    res.once('close', () => finish(!res.writableFinished));
    next();
  });
}
module.exports = { requestTiming };
