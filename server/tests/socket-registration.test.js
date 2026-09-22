const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function registrationHarness() {
  const onlineUsers = {};
  const presence = [];
  const chatSockets = [];
  let connect;
  const dependencies = {
    "../routes/auth-middleware": () => {},
    "../models/User": { updateOne: async () => {} },
    "../models/state": { onlineUsers },
    "./chatEvents": { registerChatEvents: (_io, socket) => chatSockets.push(socket.id) },
    "../services/chatPersistence": { authorizeRoom: async () => {}, authorizePair: async () => {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sockets/connection.js"), "utf8"), {
    module,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    global: { fetch },
    console,
  });
  const io = {
    use() {},
    on(name, handler) { assert.equal(name, "connection"); connect = handler; },
    emit(name, payload) { presence.push({ name, userId: payload.userId }); },
  };
  module.exports.registerConnection(io);
  return {
    onlineUsers, presence, chatSockets,
    connect(id, userId = "alice") {
      const handlers = new Map();
      const joins = [];
      const events = [];
      connect({ id, userId,
        join(room) { joins.push(room); },
        emit(name, payload) { events.push({ name, userId: payload.userId }); },
        on(name, handler) { handlers.set(name, handler); },
      });
      return { handlers, joins, events };
    },
  };
}

test("register and user:register aliases do presence work once per connection", () => {
  const harness = registrationHarness();
  const socket = harness.connect("socket-1");
  for (let i = 0; i < 5; i++) {
    socket.handlers.get("register")("alice");
    socket.handlers.get("user:register")("alice");
  }
  socket.handlers.get("register")("someone-else");
  assert.deepEqual(socket.joins, ["alice"]);
  assert.deepEqual(harness.presence, [{ name: "presence:online", userId: "alice" }]);
  assert.deepEqual(socket.events, [{ name: "connected", userId: "alice" }]);
  assert.deepEqual(harness.onlineUsers, { alice: "socket-1" });
  assert.deepEqual(harness.chatSockets, ["socket-1"]);
});

test("a new connection still registers; old compatibility events cannot replace it", () => {
  const harness = registrationHarness();
  const first = harness.connect("socket-old");
  const second = harness.connect("socket-new");
  first.handlers.get("register")("alice");
  first.handlers.get("user:register")("alice");
  second.handlers.get("register")("alice");
  second.handlers.get("user:register")("alice");
  assert.deepEqual(harness.onlineUsers, { alice: "socket-new" });
  assert.equal(harness.presence.length, 2);
  assert.deepEqual(first.joins, ["alice"]);
  assert.deepEqual(second.joins, ["alice"]);
  assert.deepEqual(harness.chatSockets, ["socket-old", "socket-new"]);
});
