/**
 * ============================================================
 * 📁 File: ai/cupidKnowledge.js
 * 🧠 Purpose: RomBuzz knowledge base for Cupid Support.
 *
 * Used by:
 *   - ai/cupidSupportBrain.js
 *   - POST /api/cupid-support/chat
 *
 * Notes:
 *   - This is not a paid AI model.
 *   - This is a controlled support knowledge base.
 *   - Cupid only answers from this knowledge.
 *   - If no close match is found, Cupid asks user to create a ticket.
 * ============================================================
 */

const CUPID_KNOWLEDGE = [
  {
    id: "otp_email_not_received",
    title: "OTP or verification email not received",
    keywords: [
      "otp",
      "verification",
      "verify",
      "email code",
      "code",
      "resend",
      "spam",
      "junk",
      "not received",
      "didn't get",
      "did not get",
    ],
    answer:
      "If you did not receive your OTP or verification email, first check your spam or junk folder. Make sure the email address is typed correctly, wait about one minute, then tap Resend code if the option is available. If it still does not arrive, create a Cupid Support ticket and RomBuzz admin will check it manually.",
  },
  {
    id: "google_login_issue",
    title: "Google login is not working",
    keywords: [
      "google",
      "google login",
      "gmail",
      "oauth",
      "sign in with google",
      "continue with google",
      "login error",
      "google error",
    ],
    answer:
      "For Google login issues, try using the same Google account you originally used for RomBuzz. If you backed out of the Google picker, open Google login again and choose an account. If the issue continues, try email login for now and create a Cupid Support ticket with the exact error message.",
  },
  {
    id: "wrong_password_or_account",
    title: "Login, password, or account issue",
    keywords: [
      "login",
      "password",
      "wrong password",
      "invalid credentials",
      "account doesn't exist",
      "account does not exist",
      "forgot password",
      "reset password",
      "cannot login",
      "can't login",
    ],
    answer:
      "If your password is wrong, use the forgot password or reset password option. If RomBuzz says the account does not exist, make sure you are using the same email you signed up with. If you still cannot access the account, create a Cupid Support ticket so RomBuzz admin can help verify the issue.",
  },
  {
    id: "profile_setup",
    title: "Profile setup and profile completion",
    keywords: [
      "profile",
      "complete profile",
      "setup profile",
      "bio",
      "interests",
      "looking for",
      "avatar",
      "profile complete",
      "onboarding",
    ],
    answer:
      "To improve your RomBuzz profile, add a clear avatar, complete your bio, select what you are looking for, add interests, and upload good photos or reels. A more complete profile helps Discover and other RomBuzz features work better.",
  },
  {
    id: "photo_upload_issue",
    title: "Photo, avatar, or media upload issue",
    keywords: [
      "photo",
      "avatar",
      "image",
      "upload",
      "media",
      "reel",
      "video",
      "gallery",
      "blank image",
      "media not loading",
      "picture",
    ],
    answer:
      "If photos, avatar, reels, or media are not uploading, check your internet connection and try again. Make sure RomBuzz has photo and camera permissions. If media appears blank, it may be a storage or network issue. Create a Cupid Support ticket and include which screen failed and what media type you tried to upload.",
  },
  {
    id: "discover_no_users",
    title: "Discover is not showing users",
    keywords: [
      "discover",
      "matches",
      "match",
      "nearby",
      "no users",
      "no matches",
      "can't find people",
      "cannot find people",
      "filters",
      "distance",
      "age range",
    ],
    answer:
      "If Discover is not showing users, make sure your location is enabled and your filters are not too strict. Try expanding distance, widening age range, and checking your Looking For settings. If you still see no users, create a Cupid Support ticket so RomBuzz admin can check your account.",
  },
  {
    id: "microbuzz_help",
    title: "MicroBuzz help",
    keywords: [
      "microbuzz",
      "live layer",
      "radar",
      "nearby live",
      "selfie",
      "location",
      "camera",
      "activate",
      "blank page",
      "nearby users",
    ],
    answer:
      "MicroBuzz is RomBuzz’s live nearby discovery feature. It uses your selfie and location to show active nearby users. If MicroBuzz is blank, allow camera and location permissions, refresh once, and make sure your internet is stable. If it still fails, create a Cupid Support ticket with screenshots.",
  },
  {
    id: "chat_help",
    title: "Chat help",
    keywords: [
      "chat",
      "message",
      "messages",
      "can't message",
      "cannot message",
      "conversation",
      "reply",
      "unsend",
      "edit message",
      "pinned",
      "reaction",
    ],
    answer:
      "RomBuzz chat is for matched users. If you cannot message someone, make sure you are matched and neither user has blocked the other. If messages are not loading, refresh the chat and check your internet connection. If the issue continues, create a Cupid Support ticket.",
  },
  {
    id: "video_call_help",
    title: "Video call help",
    keywords: [
      "video",
      "video call",
      "call",
      "camera",
      "microphone",
      "mic",
      "agora",
      "incoming call",
      "missed call",
      "call failed",
    ],
    answer:
      "RomBuzz video calls require camera and microphone permissions. Make sure both users are matched and have a stable internet connection. If a call fails, try closing and reopening the app. If calls keep failing, create a Cupid Support ticket and include whether the issue happened when starting, accepting, minimizing, or ending the call.",
  },
  {
    id: "gifts_buzzcoin_help",
    title: "Gifts and BuzzCoin",
    keywords: [
      "gift",
      "gifts",
      "buzzcoin",
      "bc",
      "coin",
      "wallet",
      "balance",
      "send gift",
      "creator earnings",
      "paid media",
      "purchase",
    ],
    answer:
      "RomBuzz uses BuzzCoin for gifts and some premium interactions. If your gift, wallet balance, purchased media, or BuzzCoin action looks wrong, create a Cupid Support ticket with the amount, user, and screen where it happened so RomBuzz admin can review it.",
  },
  {
    id: "reports_and_safety",
    title: "Report, block, and safety",
    keywords: [
      "report",
      "report user",
      "block",
      "unblock",
      "safety",
      "harassment",
      "scam",
      "fake",
      "abuse",
      "threat",
      "stalking",
      "danger",
    ],
    answer:
      "For safety issues, use the report or block option from the user profile, chat, post, reel, comment, or Settings → Blocking & Safety. If there is danger, threats, blackmail, stalking, underage concern, or harassment, submit a report immediately. You can also create a Cupid Support ticket if you need admin help.",
  },
  {
    id: "blocking_help",
    title: "Blocking and unblocking",
    keywords: [
      "blocked",
      "blocking",
      "block list",
      "unblock",
      "blocked users",
      "remove block",
      "can't see user",
      "cannot see user",
    ],
    answer:
      "Blocking prevents unwanted interaction with another user. To view blocked users, go to Settings → Blocking & Safety. From there you can search your blocked list and unblock someone if needed.",
  },
  {
    id: "notifications_help",
    title: "Notifications help",
    keywords: [
      "notification",
      "notifications",
      "push",
      "alert",
      "not getting notifications",
      "call notification",
      "message notification",
      "likes notification",
    ],
    answer:
      "If notifications are not working, make sure notifications are enabled for RomBuzz in your phone settings and inside RomBuzz notification settings. For call notifications, also make sure the app has notification permission. If notifications still fail, create a Cupid Support ticket.",
  },
  {
    id: "privacy_visibility",
    title: "Privacy and visibility",
    keywords: [
      "privacy",
      "visibility",
      "private",
      "public",
      "who can see",
      "hide",
      "photos privacy",
      "reels privacy",
      "matches only",
    ],
    answer:
      "RomBuzz privacy settings control what others can see. Some photos, reels, or profile fields may be public, matches-only, private, or limited depending on your settings. Check Settings → Privacy or your profile media settings if something is not visible.",
  },
  {
    id: "delete_account",
    title: "Delete or deactivate account",
    keywords: [
      "delete account",
      "deactivate",
      "remove account",
      "close account",
      "account delete",
      "quit",
    ],
    answer:
      "To delete or deactivate your RomBuzz account, go to Settings → Delete Account. Make sure you understand that deleting an account may remove profile data and access. If the delete option does not work, create a Cupid Support ticket.",
  },
  {
    id: "premium_help",
    title: "Premium help",
    keywords: [
      "premium",
      "upgrade",
      "subscription",
      "paid",
      "pay",
      "payment",
      "premium feature",
      "locked",
    ],
    answer:
      "Some RomBuzz features may become premium features over time, such as advanced Cupid tools, video calling, gifts, boosts, or special interactions. If you paid and something did not unlock, create a Cupid Support ticket with the payment details and screen where the issue happened.",
  },
  {
    id: "app_bug_or_crash",
    title: "Bug, crash, or app issue",
    keywords: [
      "bug",
      "crash",
      "error",
      "broken",
      "not working",
      "blank",
      "stuck",
      "freeze",
      "loading",
      "failed",
      "issue",
    ],
    answer:
      "If something in RomBuzz is broken, stuck, blank, or crashing, try refreshing the app first. If it continues, create a Cupid Support ticket and include the screen name, what you tapped, what happened, and any screenshot or exact error message.",
  },
];

module.exports = {
  CUPID_KNOWLEDGE,
};