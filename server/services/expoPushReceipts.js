// Retry pending receipt reads after restart; log error codes without tokens or message content.
const Receipt = require("../models/ExpoPushReceipt");
const User = require("../models/User");
const { expoHeaders } = require("./expoPushTransport");
const report = code => console.warn("Expo push delivery error:", code);
async function prune(tokens) {
  await User.updateMany({}, { $pull: { pushTokens: { token: { $in: tokens } } } });
  await User.updateMany({ pushToken: { $in: tokens } }, { $unset: { pushToken: "" } }, { strict: false });
}
async function saveReceipt(ticketId, token) {
  const now = Date.now();
  await Receipt.updateOne({ ticketId }, { $setOnInsert: {
    token, nextCheckAt: new Date(now + 15 * 60000), expiresAt: new Date(now + 24 * 3600000),
  } }, { upsert: true });
}
async function checkPushReceipts() {
  const rows = await Receipt.find({ nextCheckAt: { $lte: new Date() } }).limit(1000).lean();
  if (!rows.length) return;
  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST", headers: expoHeaders(), body: JSON.stringify({ ids: rows.map(row => row.ticketId) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { report(`ReceiptHTTP_${response.status}`); return; }
  const data = (await response.json())?.data || {};
  for (const row of rows) {
    const receipt = data[row.ticketId];
    if (!receipt) {
      if (+new Date(row.expiresAt) - Date.now() < 3600000) report("ReceiptUnavailable");
      await Receipt.updateOne({ ticketId: row.ticketId }, { $set: { nextCheckAt: new Date(Date.now() + 15 * 60000) } });
      continue;
    }
    if (receipt.status !== "ok") {
      const code = receipt.details?.error || "ReceiptError";
      report(code);
      if (code === "DeviceNotRegistered") await prune([row.token]);
    }
    await Receipt.deleteOne({ ticketId: row.ticketId });
  }
}
function startPushReceiptJob() {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await checkPushReceipts(); } catch { report("ReceiptCheckFailed"); } finally { busy = false; }
  };
  void run();
  const timer = setInterval(run, 60000);
  timer.unref?.();
  return timer;
}
module.exports = { saveReceipt, prune, report, checkPushReceipts, startPushReceiptJob };
