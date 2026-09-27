// Normalization contract mirrored by mobile chatMediaRows.ts; fixture-tested.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatMediaRow = chatMediaRow;
exports.chatMediaRows = chatMediaRows;
function chatMediaRow(message) {
    if (!message || message.deleted)
        return null;
    let payload = {};
    if (String(message.text || "").startsWith("::RBZ::")) {
        try {
            payload = JSON.parse(message.text.slice(7)) || {};
        }
        catch { }
    }
    for (const e of [message.ephemeral, payload.ephemeral]) {
        if ([1, 2].includes(e?.maxViews) || ["once", "twice"].includes(e?.mode) || Number(e?.viewsLeft) > 0)
            return null;
    }
    const stream = String(message.provider || message.storage || payload.provider || payload.storage || "").toLowerCase() === "cloudflare_stream" ||
        message.streamUid || message.cloudflareStream?.uid || payload.streamUid || payload.cloudflareStream?.uid;
    const url = String((stream && (message.playback?.hls || payload.playback?.hls)) || message.url || message.mediaUrl ||
        payload.url || payload.mediaUrl || payload.media?.url || payload.media?.secure_url || payload.secure_url || "").trim();
    const id = String(message.id || message._id || "");
    if (!id || !url)
        return null;
    const type = String(payload.mediaType || payload.type || payload.kind || "").toLowerCase();
    const createdAtMs = new Date(message.createdAt || message.time || 0).getTime() || 0;
    const giftPriceBC = Math.max(0, Math.floor(Number(message.gift?.priceBC ?? message.gift?.amount ?? payload.gift?.priceBC ?? payload.gift?.amount ?? payload.priceBC ?? payload.amount ?? 0) || 0));
    return {
        id, url, createdAtMs, giftPriceBC,
        thumbnailUrl: String(message.thumbnailUrl || payload.thumbnailUrl || message.playback?.thumbnail || payload.playback?.thumbnail || ""),
        mediaType: String(message.mediaType).toLowerCase() === "video" || type === "video" ? "video" : "image",
        giftLocked: !!(message.gift?.locked || payload.gift?.locked || payload.locked),
        fromId: String(message.from || message.senderId || ""), toId: String(message.to || message.receiverId || ""),
        unlockedBy: [...new Set([...(Array.isArray(message.gift?.unlockedBy) ? message.gift.unlockedBy : []), ...(Array.isArray(payload.gift?.unlockedBy) ? payload.gift.unlockedBy : [])].map(String))],
    };
}
function chatMediaRows(messages, kind) {
    const byId = new Map();
    for (const message of messages) {
        const row = chatMediaRow(message);
        if (row && (row.giftLocked || row.giftPriceBC > 0) === (kind === "purchased"))
            byId.set(row.id, row);
    }
    return [...byId.values()].sort((a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id));
}
