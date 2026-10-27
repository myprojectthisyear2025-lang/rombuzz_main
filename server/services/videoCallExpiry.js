/** Schedules atomic unanswered-call expiry and recovers timers after server restarts. */
module.exports = function createVideoCallExpiry({ Call, onExpired }) {
  const timers = new Map();
  const log = (error) => console.error("Video call expiry:", error);

  function cancel(id) {
    clearTimeout(timers.get(String(id)));
    timers.delete(String(id));
  }

  async function expire(id) {
    const now = new Date();
    const call = await Call.findOneAndUpdate(
      { id: String(id), status: "ringing", expiresAt: { $lte: now } },
      {
        $set: {
          status: "missed",
          missedAt: now,
          endedAt: now,
          lastReason: "ring_timeout",
        },
      },
      { new: true },
    );

    if (call) {
      cancel(id);
      await onExpired(call);
    }

    return call;
  }

  function schedule(call) {
    const id = String(call.id);
    const deadline = new Date(call.expiresAt).getTime();
    if (!Number.isFinite(deadline) || timers.has(id)) return;

    const timer = setTimeout(() => {
      timers.delete(id);
      expire(id).catch(log);
    }, Math.max(0, deadline - Date.now()));

    timer.unref?.();
    timers.set(id, timer);
  }

  let recovering = false;

  async function recover() {
    if (recovering) return;
    recovering = true;

    try {
      const calls = await Call.find({
        status: "ringing",
        expiresAt: { $ne: null },
      }).select("id expiresAt").lean();

      calls.forEach(schedule);
    } catch (error) {
      log(error);
    } finally {
      recovering = false;
    }
  }

  const sweep = setInterval(recover, 5000);
  sweep.unref?.();
  void recover();

  return { schedule, cancel, expire };
};