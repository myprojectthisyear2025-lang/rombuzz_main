/**
 * File: server/services/signupBonusService.js
 * Purpose: Save signup completion and award 100 spendable coins once,
 * atomically, without rewarding existing completed accounts.
 */

const User = require("../models/User");
const BuzzCoinLedger = require("../models/BuzzCoinLedger");
const { creditBuzzCoins } = require("./buzzCoinService");

async function saveCompletedSignup(user) {
  await User.db.transaction(async (session) => {
    const previous = await User.findById(user._id)
      .select("profileComplete")
      .session(session);

    if (!previous) {
      throw new Error("Signup account no longer exists.");
    }

    const referenceId = `signup_bonus:${user.id}`;

    const alreadyAwarded = await BuzzCoinLedger.exists({
      userId: String(user.id),
      source: "signup_bonus",
      referenceId,
    }).session(session);

    await user.save({ session });

    if (!previous.profileComplete && !alreadyAwarded) {
      await creditBuzzCoins({
        userId: user.id,
        amountBC: 100,
        type: "credit",
        source: "signup_bonus",
        referenceId,
        reason: "Welcome to RomBuzz! Free signup BuzzCoins.",
        metadata: { offer: "signup_100_bc" },
        session,
      });
    }
  });

  // Avoid retaining an ended transaction session on this document.
  user.$session(null);
}

module.exports = { saveCompletedSignup };