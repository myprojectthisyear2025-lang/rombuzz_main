/**
 * ============================================================
 * 📁 File: routes/microbuzzSessionActions.js
 * 🎯 Purpose: Session-only MicroBuzz actions without bloating main route.
 * ============================================================
 */
const express =
  require("express");

const router =
  express.Router();

const authMiddleware =
  require("./auth-middleware");

const MicroBuzzBuzz =
  require("../models/MicroBuzzBuzz");

const {
  ignoreForCurrentSession,
} = require(
  "../services/microbuzzSessionService"
);

router.post(
  "/session-ignore/:targetId",
  authMiddleware,
  async (req, res) => {
    try {
      const byId =
        String(
          req.user.id
        );

      const fromId =
        String(
          req.params.targetId ||
            ""
        );

      if (!fromId) {
        return res
          .status(400)
          .json({
            error:
              "targetId required",
          });
      }

      if (
        byId ===
        fromId
      ) {
        return res
          .status(400)
          .json({
            error:
              "Cannot ignore yourself",
          });
      }

      const saved =
        await ignoreForCurrentSession(
          byId,
          fromId
        );

      if (!saved) {
        return res
          .status(409)
          .json({
            error:
              "MicroBuzz session is not active",
          });
      }

      await MicroBuzzBuzz.deleteMany({
        $or: [
          {
            fromId,
            toId:
              byId,
          },
          {
            fromId:
              byId,
            toId:
              fromId,
          },
        ],
      });

      return res.json({
        success: true,
      });
    } catch (err) {
      console.error(
        "❌ MicroBuzz session-ignore failed:",
        err
      );

      return res
        .status(500)
        .json({
          error:
            "Ignore failed",
        });
    }
  }
);

module.exports = router;