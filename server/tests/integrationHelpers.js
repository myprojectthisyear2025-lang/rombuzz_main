/**
 * Path: server/tests/integrationHelpers.js
 * Purpose: Start real backend processes and clients using only disposable local test databases.
 */
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");
const secret = "synthetic-migration-test-secret";

async function startBackend(uri) {
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(uri)) throw new Error("Test runner refuses a nonlocal database");
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const child = spawn(process.execPath, ["index.js"], {
    cwd: path.resolve(__dirname, ".."), windowsHide: true,
    env: { ...process.env, NODE_ENV: "test", MONGO_URI: uri, PORT: String(port), JWT_SECRET: secret,
      DISABLE_BACKGROUND_JOBS: "true", SENTRY_DSN: "", RESEND_API_KEY: "re_synthetic_test_only",
      R2_BUCKET_NAME: "synthetic-test", R2_ACCESS_KEY_ID: "synthetic", R2_SECRET_ACCESS_KEY: "synthetic",
      R2_ENDPOINT: "http://127.0.0.1:1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-12000); });
  child.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-12000); });
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (logs.includes("API running on port")) { clearInterval(timer); clearTimeout(timeout); resolve(); }
      else if (child.exitCode !== null) { clearInterval(timer); clearTimeout(timeout); reject(new Error(logs)); }
    }, 50);
    const timeout = setTimeout(() => { clearInterval(timer); child.kill(); reject(new Error(`Startup timeout: ${logs}`)); }, 120000);
  });
  return { child, url: `http://127.0.0.1:${port}`, logs: () => logs };
}
async function stopBackend(backend) {
  if (backend.child.exitCode !== null) return;
  await new Promise((resolve) => { backend.child.once("exit", resolve); backend.child.kill(); });
}
async function request(backend, user, route, options = {}) {
  const response = await fetch(`${backend.url}/api${route}`, {
    method: options.method || "GET", headers: { "Content-Type": "application/json",
      Authorization: `Bearer ${jwt.sign({ id: user }, secret)}` },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new Error(`${route}: non-JSON response (${response.status})`); }
  if (response.status !== (options.status || 200)) throw new Error(`${route}: ${response.status} ${JSON.stringify(body)}\n${backend.logs().slice(-3000)}`);
  return body;
}
async function connectClient(backend, id) {
  const socket = io(backend.url, { transports: ["websocket"], forceNew: true, reconnection: false,
    auth: { token: jwt.sign({ id }, secret) } });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
}
const emit = (socket, event, packet) => new Promise((resolve, reject) => {
  socket.timeout(10000).emit(event, packet, (error, result) => error ? reject(error) : resolve(result));
});
const event = (socket, name, predicate = () => true) => new Promise((resolve, reject) => {
  const handler = (payload) => { if (predicate(payload)) { clearTimeout(timer); socket.off(name, handler); resolve(payload); } };
  const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Missing socket event ${name}`)); }, 10000);
  socket.on(name, handler);
});
module.exports = { startBackend, stopBackend, request, connectClient, emit, event };
