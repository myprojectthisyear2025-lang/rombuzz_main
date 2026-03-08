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

      // ✅ also join a private room for direct targeted emits
      socket.join(String(userId));

      console.log("✅ User registered:", userId, "→", socket.id);
    });

    // ✅ active chat room join
    socket.on("joinRoom", (roomId) => {
      if (!roomId) return;
      socket.join(String(roomId));
      console.log("🚪 Joined room:", roomId, "socket:", socket.id);
    });

    // ✅ active chat room leave
    socket.on("leaveRoom", (roomId) => {
      if (!roomId) return;
      socket.leave(String(roomId));
      console.log("🚪 Left room:", roomId, "socket:", socket.id);
    });

    // ✅ relay typing state to the peer + room
    socket.on("typing", ({ roomId, from, to, typing }) => {
      if (!roomId || !from || !to) return;

      const payload = {
        roomId: String(roomId),
        from: String(from),
        to: String(to),
        typing: !!typing,
      };

      // room broadcast (exclude sender)
      socket.to(String(roomId)).emit("typing", payload);

      // direct fallback to peer socket / private room
      const peerSocketId = onlineUsers[String(to)];
      if (peerSocketId) {
        io.to(peerSocketId).emit("typing", payload);
      }
      io.to(String(to)).emit("typing", payload);
    });

    // ✅ relay seen receipts
    socket.on("message:seen", ({ roomId, msgId, from, to }) => {
      if (!roomId || !msgId || !from || !to) return;

      const payload = {
        roomId: String(roomId),
        msgId: String(msgId),
        from: String(from),
        to: String(to),
        lastSeenId: String(msgId),
      };

      socket.to(String(roomId)).emit("message:seen", payload);

      const peerSocketId = onlineUsers[String(to)];
      if (peerSocketId) {
        io.to(peerSocketId).emit("message:seen", payload);
      }
      io.to(String(to)).emit("message:seen", payload);
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
