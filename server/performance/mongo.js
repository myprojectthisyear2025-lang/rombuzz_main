/** Path: server/performance/mongo.js
 * Purpose: Logical Mongoose work plus separate driver-command spans, without inspecting query values. */
const { enabled, storage, begin, measure } = require('./context');
const installed = new WeakSet();
function installMongoose(mongoose) {
  if (!enabled || installed.has(mongoose)) return;
  installed.add(mongoose);
  const initialize = mongoose.Document.prototype.$init;
  mongoose.Document.prototype.$init = function (...args) {
    const ctx = storage.getStore();
    if (!ctx || ctx.hydrating) return initialize.apply(this, args);
    ctx.hydrating = true;
    const stop = begin('mongoose.document-init', 'hydrate', ctx);
    try { return initialize.apply(this, args); }
    finally { stop(); ctx.hydrating = false; }
  };
  for (const [proto, method, name] of [
    [mongoose.Query.prototype, 'exec', function () { return `${this.model.modelName}.${this.op}`; }],
    [mongoose.Aggregate.prototype, 'exec', function () { return `${this._model?.modelName || 'model'}.aggregate`; }],
    [mongoose.Model.prototype, 'save', function () { return `${this.constructor.modelName}.save`; }],
    [mongoose.Model.prototype, '$save', function () { return `${this.constructor.modelName}.create-save`; }],
  ]) {
    const original = proto[method];
    proto[method] = function (...args) {
      if (!storage.getStore()) return original.apply(this, args);
      return measure(name.call(this), () => original.apply(this, args), 'mongo');
    };
  }
}
function attachMongoCommands(client) {
  if (!enabled || installed.has(client)) return;
  installed.add(client);
  const active = new Map();
  const commands = new Set(['find', 'getMore', 'aggregate', 'count', 'distinct', 'insert', 'update', 'delete', 'findAndModify']);
  client.on('commandStarted', e => {
    const ctx = storage.getStore();
    if (!ctx || !commands.has(e.commandName) || active.size >= 512) return;
    // Deliberately never inspect e.command, replies, connection addresses or database names.
    active.set(e.requestId, { stop: begin(e.commandName, 'mongo-command', ctx), at: Date.now() });
  });
  const end = e => { active.get(e.requestId)?.stop(); active.delete(e.requestId); };
  client.on('commandSucceeded', end);
  client.on('commandFailed', end);
  const cleanup = setInterval(() => {
    for (const [id, entry] of active) if (Date.now() - entry.at > 60000) { entry.stop(); active.delete(id); }
  }, 30000);
  cleanup.unref();
  client.once('close', () => clearInterval(cleanup));
}
module.exports = { installMongoose, attachMongoCommands };
