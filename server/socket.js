// ============================================================
// 📁 File: server/socket.js
// 🎯 Purpose: Central Socket.IO setup + online user tracking
// ============================================================

let io = null;

// userId -> socketId
const onlineUsers = {};

function initSocket(serverIO) {
  io = serverIO;

  io.on("connection", (socket) => {
    console.log("🟢 Socket connected:", socket.id);

    socket.on("user:register", (userId) => {
      if (!userId) return;

      onlineUsers[userId] = socket.id;
      console.log("✅ User registered:", userId, "→", socket.id);
    });

    socket.on("disconnect", () => {
      console.log("🔴 Socket disconnected:", socket.id);

      // remove user safely
      for (const [uid, sid] of Object.entries(onlineUsers)) {
        if (sid === socket.id) {
          delete onlineUsers[uid];
          console.log("🧹 User removed:", uid);
          break;
        }
      }
    });
  });
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io instance not initialized");
  }
  return io;
}

module.exports = {
  initSocket,
  getIO,
  onlineUsers,
};
