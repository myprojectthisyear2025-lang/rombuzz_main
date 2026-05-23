/**
 * ============================================================
 * 📁 File: ai/cupidSupportBrain.js
 * 🧠 Purpose: Local Cupid Support brain.
 *
 * Used by:
 *   - routes/cupidSupport.js
 *
 * Behavior:
 *   - Receives a user question
 *   - Searches RomBuzz knowledge
 *   - Returns a support answer if close enough
 *   - Otherwise tells frontend to show ticket creation
 *
 * Notes:
 *   - No paid AI API.
 *   - No hallucination.
 *   - Only answers from cupidKnowledge.js.
 * ============================================================
 */

const { CUPID_KNOWLEDGE } = require("./cupidKnowledge");

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "so",
  "the",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "where",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  const normalized = normalizeText(value);

  return normalized
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function scoreKnowledgeItem(message, item) {
  const normalizedMessage = normalizeText(message);
  const messageTokens = uniqueList(tokenize(message));

  const keywords = Array.isArray(item.keywords) ? item.keywords : [];
  const normalizedKeywords = keywords.map(normalizeText).filter(Boolean);

  let score = 0;
  const matchedKeywords = [];

  for (const keyword of normalizedKeywords) {
    if (!keyword) continue;

    const keywordTokens = tokenize(keyword);

    if (keyword.includes(" ") && normalizedMessage.includes(keyword)) {
      score += 8 + keywordTokens.length;
      matchedKeywords.push(keyword);
      continue;
    }

    const keywordTokenHits = keywordTokens.filter((token) =>
      messageTokens.includes(token)
    );

    if (keywordTokenHits.length > 0) {
      score += keywordTokenHits.length * 3;
      matchedKeywords.push(keyword);
    }
  }

  const titleTokens = tokenize(item.title || "");
  const titleHits = titleTokens.filter((token) => messageTokens.includes(token));
  score += titleHits.length * 2;

  const answerTokens = tokenize(item.answer || "");
  const answerHits = answerTokens.filter((token) => messageTokens.includes(token));
  score += Math.min(answerHits.length, 4);

  return {
    item,
    score,
    matchedKeywords: uniqueList(matchedKeywords).slice(0, 8),
  };
}

function findBestCupidAnswer(message = "") {
  const cleanMessage = String(message || "").trim();

  if (!cleanMessage) {
    return {
      answered: false,
      confidence: 0,
      reply: "Ask me a RomBuzz question and I’ll try to help.",
      showTicketButton: false,
      matchedTopic: null,
      suggestions: getDefaultSuggestions(),
    };
  }

  const results = CUPID_KNOWLEDGE.map((item) =>
    scoreKnowledgeItem(cleanMessage, item)
  ).sort((a, b) => b.score - a.score);

  const best = results[0] || null;
  const second = results[1] || null;

  const bestScore = Number(best?.score || 0);
  const secondScore = Number(second?.score || 0);

  const isStrongMatch = bestScore >= 8;
  const isOkayMatch = bestScore >= 6 && bestScore >= secondScore + 2;

  if (best && (isStrongMatch || isOkayMatch)) {
    return {
      answered: true,
      confidence: Math.min(0.98, Number((bestScore / 18).toFixed(2))),
      reply: best.item.answer,
      showTicketButton: false,
      matchedTopic: {
        id: best.item.id,
        title: best.item.title,
        score: bestScore,
        matchedKeywords: best.matchedKeywords,
      },
      suggestions: getRelatedSuggestions(best.item.id),
    };
  }

  return {
    answered: false,
    confidence: Math.min(0.45, Number((bestScore / 18).toFixed(2))),
    reply:
      "I’m not fully sure about that yet. You can create a Cupid Support ticket and RomBuzz admin will help you manually.",
    showTicketButton: true,
    matchedTopic: best
      ? {
          id: best.item.id,
          title: best.item.title,
          score: bestScore,
          matchedKeywords: best.matchedKeywords,
        }
      : null,
    suggestions: getDefaultSuggestions(),
  };
}

function getDefaultSuggestions() {
  return [
    "I didn’t get my OTP email",
    "Google login is not working",
    "I cannot upload my photo",
    "Discover is not showing users",
    "How do I report someone?",
  ];
}

function getRelatedSuggestions(topicId = "") {
  const common = {
    otp_email_not_received: [
      "How do I resend my code?",
      "What if my email is wrong?",
      "I still cannot verify my account",
    ],
    google_login_issue: [
      "Can I use email login instead?",
      "Why does Google login fail?",
      "I backed out of Google login",
    ],
    photo_upload_issue: [
      "My avatar is not showing",
      "My media is blank",
      "My reel upload failed",
    ],
    discover_no_users: [
      "How do I change filters?",
      "Why are there no nearby users?",
      "How does Discover work?",
    ],
    reports_and_safety: [
      "How do I block someone?",
      "How do I report a fake profile?",
      "What happens after I report?",
    ],
    microbuzz_help: [
      "Why is MicroBuzz blank?",
      "Why does MicroBuzz need location?",
      "Why does MicroBuzz need selfie?",
    ],
    chat_help: [
      "Why can’t I message someone?",
      "Why are my messages not loading?",
      "Can blocked users message me?",
    ],
    video_call_help: [
      "Why did my video call fail?",
      "Why is camera not working?",
      "Why did I miss a call?",
    ],
    gifts_buzzcoin_help: [
      "Why did my gift fail?",
      "Where is my BuzzCoin balance?",
      "Why is paid media locked?",
    ],
  };

  return common[topicId] || getDefaultSuggestions();
}

module.exports = {
  findBestCupidAnswer,
  getDefaultSuggestions,
};