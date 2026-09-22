/**
 * Path: server/socket.js
 * Purpose: Share Socket.IO and transient presence; handlers live in sockets/connection.js.
 */
const { onlineUsers } = require("./models/state");
let io = null;
function initSocket(serverIO) { io = serverIO; }
function getIO() {
  if (!io) throw new Error("Socket.io instance not initialized");
  return io;
}
module.exports = { initSocket, getIO, onlineUsers };
