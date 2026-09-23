/** Path: server/performance/context.js
 * Purpose: Opt-in bounded request spans; only code-owned labels and numeric metadata. */
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const storage = new AsyncLocalStorage();
const enabled = process.env.PERF_DIAGNOSTICS === 'true';
const rate = Math.max(0, Math.min(1, Number(process.env.PERF_SAMPLE_RATE ?? 1) || 0));
const now = () => performance.now();
const noop = () => {};
const label = (value) => String(value).replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 100);
function begin(name, category = 'logic', context = storage.getStore()) {
  if (!context || context.closed) return noop;
  if (context.spans.length + context.open.size >= 256) { context.dropped++; return noop; }
  const start = now() - context.start;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    context.open.delete(end);
    context.spans.push({ name: label(name), category, startMs: start, durationMs: now() - context.start - start });
  };
  context.open.add(end);
  return end;
}
function union(spans, category, limit = Infinity) {
  const intervals = spans.filter(s => s.category === category)
    .map(s => [s.startMs, Math.min(limit, s.startMs + s.durationMs)])
    .sort((a, b) => a[0] - b[0]);
  let total = 0, end = 0;
  for (const [a, b] of intervals) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}
function measure(name, fn, category = 'logic') {
  const stop = begin(name, category);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(
      value => { stop(); return value; }, error => { stop(); throw error; });
    stop(); return result;
  } catch (error) { stop(); throw error; }
}
module.exports = { storage, enabled, rate, now, begin, measure, union, label };
