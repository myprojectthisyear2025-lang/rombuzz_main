/** Path: server/performance/express.js
 * Purpose: Time installed Express 5 leaf middleware without changing routing, arity or next/error semantics. */
const { storage, enabled, begin } = require('./context');
const wrapped = new WeakSet();
function instrumentExpress(app) {
  if (!enabled) return;
  function walk(stack, template = '') {
    for (const layer of stack || []) {
      const fn = layer.handle;
      if (wrapped.has(layer)) continue;
      wrapped.add(layer);
      if (layer.route) {
        walk(layer.route.stack, String(layer.route.path));
        continue;
      }
      if (fn.stack) { walk(fn.stack, template); continue; }
      if (fn.name === 'requestTiming') continue;
      const name = fn.name || (template ? 'route.handler' : 'middleware.anonymous');
      const category = name === 'authMiddleware' ? 'auth' : template ? 'handler' : 'middleware';
      function invoke(receiver, args, nextIndex) {
        const ctx = storage.getStore();
        if (!ctx) return fn.apply(receiver, args);
        const req = args[nextIndex - 2];
        // req.baseUrl may contain dynamic IDs. Replace exact resolved parameter segments.
        if (template) {
          let base = req.baseUrl || '';
          for (const value of Object.values(req.params || {})) {
            base = base.split('/').map(s => s === String(value) ? ':param' : s).join('/');
          }
          ctx.route = base + template;
        }
        const stop = begin(name, category, ctx);
        const next = args[nextIndex];
        args[nextIndex] = function (...values) { stop(); return next.apply(this, values); };
        try {
          const result = fn.apply(receiver, args);
          if (result && typeof result.then === 'function') return result.then(
            value => { stop(); return value; }, error => { stop(); throw error; });
          return result;
        } catch (error) { stop(); throw error; }
      }
      layer.handle = fn.length === 4
        ? function (err, req, res, next) { return invoke(this, [err, req, res, next], 3); }
        : function (req, res, next) { return invoke(this, [req, res, next], 2); };
    }
  }
  walk(app.router.stack);
}
module.exports = { instrumentExpress };
