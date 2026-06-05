/**
 * ============================================================
 * 📁 File: utils/notifications.js
 * 💌 Purpose: Legacy proxy to new MongoDB-based notification system
 *
 * 🔁 Redirects all calls to utils/helpers.js → sendNotification()
 *     to maintain backward compatibility for routes still importing
 *     this old path.
 * ============================================================
 */

const { sendNotification } = require("./helpers");

/**
 * Legacy alias for compatibility
 */
async function createNotification({
  fromId,
  toId,
  type,
  message,
  href,
  entity,
  entityId,
  postId,
  postOwnerId,
  targetType,
  targetId,
  targetOwnerId,
  commentId,
  replyId,
  routeContext,
  via,
  buzzType,
  transactionId,
  priceBC,
  streak,
}) {
  return sendNotification(toId, {
    fromId,
    type,
    message,
    href,
    entity,
    entityId,
    postId,
    postOwnerId,
    targetType,
    targetId,
    targetOwnerId,
    commentId,
    replyId,
    routeContext,
    via,
    buzzType,
    transactionId,
    priceBC,
    streak,
  });
}

module.exports = {
  sendNotification,
  createNotification,
};
