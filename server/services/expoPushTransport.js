// Shared ticket handling for chat, match/activity and calls. Receipts prove handoff, not device display.
const SEND_URL = "https://exp.host/--/api/v2/push/send";
const isToken = token => /^Expo(?:nent)?PushToken\[[^\]]+\]$/.test(String(token || "").trim());
function expoHeaders() {
  return { Accept: "application/json", "Content-Type": "application/json",
    ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) };
}
function createExpoPushTransport({ fetchImpl, saveReceipt, prune, report }) {
  return async function send(messages = []) {
    const valid = messages.filter(message => isToken(message?.to));
    const invalidTokens = [], errors = [];
    let accepted = 0;
    for (let offset = 0; offset < valid.length; offset += 100) {
      const batch = valid.slice(offset, offset + 100);
      try {
        const response = await fetchImpl(SEND_URL, {
          method: "POST", headers: expoHeaders(), body: JSON.stringify(batch), signal: AbortSignal.timeout(10000),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = `HTTP_${response.status}`;
          errors.push(code); report(code); continue;
        }
        const tickets = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
        for (let index = 0; index < batch.length; index++) {
          const ticket = tickets[index];
          if (ticket?.status === "ok" && ticket.id) {
            accepted++;
            try { await saveReceipt(ticket.id, batch[index].to); }
            catch { errors.push("ReceiptPersistenceFailed"); report("ReceiptPersistenceFailed"); }
          } else {
            const code = ticket?.details?.error || "MissingPushTicket";
            errors.push(code); report(code);
            if (code === "DeviceNotRegistered") invalidTokens.push(batch[index].to);
          }
        }
      } catch {
        errors.push("PushTransportFailed"); report("PushTransportFailed");
      }
    }
    if (invalidTokens.length) {
      try { await prune([...new Set(invalidTokens)]); }
      catch { errors.push("TokenPruneFailed"); report("TokenPruneFailed"); }
    }
    return { ok: errors.length === 0, sent: accepted, sentCount: accepted, invalidTokens, errors };
  };
}
module.exports = { createExpoPushTransport, expoHeaders, isToken };
