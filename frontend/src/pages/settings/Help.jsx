/**
 * ============================================================================
 * 📁 File: Help.jsx
 * 🎯 Purpose: Full Help & Support center for RomBuzz (web + mobile reference)
 *
 * HOW TO USE:
 * - Web: Mount this component on your /help or /settings/help route.
 * - Mobile: Reuse the section structure & text to build a Help screen.
 *
 * CONTENTS:
 *  1. Getting Started
 *  2. Account & Profile
 *  3. Matching & Discovery (MicroBuzz, Discover, BuzzStreak, MatchStreak)
 *  4. Let’sBuzz Feed (posts, reels, comments, reactions, saves)
 *  5. Chat & Real-Time Features
 *  6. Meet-in-the-Middle
 *  7. Notifications
 *  8. Safety & Community Guidelines
 *  9. Troubleshooting & FAQ
 * 10. Contact & Support
 * ============================================================================
 */


export default function Help() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 text-sm md:text-base">
      {/* PAGE TITLE */}
      <h1 className="text-2xl md:text-3xl font-bold mb-2">
        Help &amp; Support
      </h1>
      <p className="text-gray-600 mb-6">
        Welcome to RomBuzz Help Center. This page explains how RomBuzz works,
        what each feature does, and how to stay safe while using the app. You
        can use this as a guide for both the website and the mobile app.
      </p>

      {/* QUICK INDEX */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-8">
        <h2 className="text-base md:text-lg font-semibold mb-2">
          📚 Quick navigation
        </h2>
        <div className="flex flex-wrap gap-2 text-xs md:text-sm">
          <a href="#getting-started" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Getting started
          </a>
          <a href="#account-profile" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Account &amp; profile
          </a>
          <a href="#matching-discovery" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Matching &amp; discovery
          </a>
          <a href="#letsbuzz" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Let&apos;sBuzz feed
          </a>
          <a href="#chat" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Chat &amp; real-time
          </a>
          <a href="#meet-middle" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Meet-in-the-Middle
          </a>
          <a href="#notifications" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Notifications
          </a>
          <a href="#safety" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Safety &amp; community
          </a>
          <a href="#faq" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            FAQ
          </a>
          <a href="#contact-support" className="px-3 py-1 rounded-full bg-white border hover:bg-gray-100">
            Contact support
          </a>
        </div>
      </div>

      <div className="space-y-8">
        {/* 1. GETTING STARTED */}
        <section id="getting-started" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            1. Getting started with RomBuzz
          </h2>
          <p className="text-gray-600 mb-3">
            RomBuzz is a real-time dating app designed for close connections in small venue. You can
            match, chat, and plan meetups in minutes using features like
            MicroBuzz, Let&apos;sBuzz feed, MatchStreak, and Meet-in-the-Middle.
          </p>
          <h3 className="font-semibold mb-2">Creating an account</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Open the Rombuzz website or app and tap <strong>Sign up</strong>.</li>
            <li>Enter your email and create a secure password, or use Google login (if available).</li>
            <li>Verify your email if you receive a one-time code (OTP).</li>
            <li>Once registered, you&apos;ll be guided to <strong>Complete your profile</strong>.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Completing your profile</h3>
          <p className="text-gray-600 mb-1">
            A complete profile helps you get more matches and better suggestions.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Add your name, age, gender, and what you&apos;re looking for.</li>
            <li>Upload photos (your first photo usually becomes your main avatar).</li>
            <li>Fill in your bio, interests, and basic details about yourself.</li>
            <li>Turn on location if you want nearby matches and MicroBuzz to work properly. Microbuzz requires your current location.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Logging in</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Use your email and password, or Google login (if set up).</li>
            <li>If you forget your password, use the <strong>Forgot password</strong> option to reset it with a code sent to your email.</li>
          </ul>
        </section>

        {/* 2. ACCOUNT & PROFILE */}
        <section id="account-profile" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            2. Account &amp; profile
          </h2>

          <h3 className="font-semibold mb-2">Editing your profile</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Go to your <strong>Profile</strong> page from the navigation.</li>
            <li>Edit your bio, photos, interests, and basic details.</li>
            <li>Update your preferences (age range, distance, interests, etc.).</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Photos &amp; gallery</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Upload clear photos that show your face and personality.</li>
            <li>You can change which photo appears as your main avatar.</li>
            <li>In some areas of the app, your photos may appear as a gallery that others can swipe through.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Privacy &amp; visibility</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Only the information you choose to share is visible to other users.</li>
            <li>You can block users you no longer want to interact with.</li>
            <li>Reporting a user sends their profile and activity for review.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Account deletion</h3>
          <p className="text-gray-600">
            If you want to permanently delete your account, you can request it
            via settings (if available) or by contacting support (see{" "}
            <a href="#contact-support" className="text-blue-600 hover:underline">
              Contact &amp; Support
            </a>{" "}
            below).
          </p>
        </section>

        {/* 3. MATCHING & DISCOVERY */}
        <section id="matching-discovery" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            3. Matching &amp; discovery
          </h2>

          <h3 className="font-semibold mb-2">MicroBuzz (instant nearby matching)</h3>
          <p className="text-gray-600 mb-1">
            MicroBuzz is designed for fast, real-time matches using your selfie
            and location (within the allowed area).
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Open the <strong>MicroBuzz</strong> section from the main navigation.</li>
            <li>Allow camera and location permissions when asked.</li>
            <li>Take a selfie and confirm it if your flow is set up that way.</li>
            <li>Tap <strong>Activate</strong> to start scanning for nearby users.</li>
            <li>When a potential match appears, you can choose to connect or skip.</li>
          </ol>
          <p className="text-gray-600 mt-2">
            If the page appears blank, try refreshing once and make sure location
            and camera permissions are granted.
          </p>

          <h3 className="font-semibold mt-4 mb-2">Discover (browsing potential matches)</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Use the <strong>Discover</strong> page to browse profiles that match your preferences.</li>
            <li>Apply filters like age range, distance, and interests (if available).</li>
            <li>Like or pass on profiles; mutual likes become matches.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">BuzzStreak &amp; MatchStreak</h3>
          <p className="text-gray-600 mb-1">
            Streaks reward you for being consistent and engaged.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              <strong>BuzzStreak</strong>: Your daily activity streak (e.g., being active, using
              core features, etc. depending on your setup).
            </li>
            <li>
              <strong>MatchStreak</strong>: A streak you maintain with specific matches (for example,
              if both of you interact daily).
            </li>
            <li>
              If you skip days, the streak may reset. Check your profile or social
              stats to see your current streak status.
            </li>
          </ul>
        </section>

        {/* 4. LETSBUZZ FEED */}
        <section id="letsbuzz" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            4. Let&apos;sBuzz feed (posts, reels &amp; interactions)
          </h2>
          <p className="text-gray-600 mb-2">
            Let&apos;sBuzz works like a private feed where you see posts, reels,
            and photos from people you&apos;ve matched with.
          </p>

          <h3 className="font-semibold mb-2">What you see</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Posts, reels, and photos shared by users you have matched with.</li>
            <li>Content might be ordered by time or relevance (depending on your setup).</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Creating posts</h3>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Go to the <strong>Let&apos;sBuzz</strong> section.</li>
            <li>Tap or click the button to create a new post or reel.</li>
            <li>Add text, and optionally photos or video (if supported).</li>
            <li>Post it to share with your matches.</li>
          </ol>

          <h3 className="font-semibold mt-4 mb-2">Reactions, comments &amp; saves</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Tap the heart or reaction button to like a post.</li>
            <li>Leave comments to interact with your matches.</li>
            <li>Use the save/bookmark icon to save posts you want to revisit later.</li>
            <li>Some comments or interactions may notify the other person directly.</li>
          </ul>
        </section>

        {/* 5. CHAT & REAL-TIME */}
        <section id="chat" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            5. Chat &amp; real-time features
          </h2>

          <h3 className="font-semibold mb-2">Starting a conversation</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Open the <strong>Chat</strong> section from the main navigation.</li>
            <li>Select a match from your chat list or tap the chat button on their profile.</li>
            <li>Type your message and send.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Match celebration overlay</h3>
          <p className="text-gray-600">
            When you and another user both like each other, a match celebration
            overlay may appear. From here, you can instantly jump into a chat
            and start a conversation.
          </p>

          <h3 className="font-semibold mt-4 mb-2">Unread messages &amp; indicators</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>The chat icon in the navigation may show a badge with unread count.</li>
            <li>Inside the chat list, new messages should be highlighted or marked as unread.</li>
            <li>If unread counts look out of sync, try refreshing the page or app.</li>
          </ul>
        </section>

        {/* 6. MEET-IN-THE-MIDDLE */}
        <section id="meet-middle" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            6. Meet-in-the-Middle
          </h2>
          <p className="text-gray-600 mb-2">
            Meet-in-the-Middle helps two people find a fair place to meet between
            both of their locations.
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>Open or receive a Meet-in-the-Middle card in chat or in its dedicated section (if available).</li>
            <li>RomBuzz calculates a midpoint between both users.</li>
            <li>Within a radius around that midpoint, you may see suggested areas or places.</li>
            <li>Select a place to propose as a meetup spot.</li>
            <li>The other user can accept or reject your suggestion.</li>
            <li>If accepted, both users can see the final place, address, and optionally open it in maps for directions.</li>
          </ol>
        </section>

        {/* 7. NOTIFICATIONS */}
        <section id="notifications" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            7. Notifications
          </h2>
          <p className="text-gray-600 mb-2">
            Notifications keep you updated on important events in RomBuzz.
          </p>

          <h3 className="font-semibold mb-2">Types of notifications</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li><strong>New match</strong> – when you and someone else like each other.</li>
            <li><strong>Messages</strong> – when someone sends you a new message.</li>
            <li><strong>Comments &amp; reactions</strong> – when someone reacts to or comments on your Let&apos;sBuzz posts.</li>
            <li><strong>MicroBuzz events</strong> – when you get a real-time match or interaction.</li>
            <li><strong>Meetup suggestions</strong> – when a match proposes a place to meet.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Actions from notifications</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Tap a notification to open the relevant profile, chat, or post.</li>
            <li>For match requests or meetup suggestions, you may see <strong>Accept</strong> / <strong>Reject</strong> buttons.</li>
            <li>Some notifications can be cleared or dismissed after viewing.</li>
          </ul>
        </section>

        {/* 8. SAFETY & COMMUNITY */}
        <section id="safety" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            8. Safety &amp; community guidelines
          </h2>

          <h3 className="font-semibold mb-2">Dating safety tips</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>Never share financial information, passwords, or sensitive personal details.</li>
            <li>Keep initial conversations inside RomBuzz until you feel safe.</li>
            <li>When meeting in person, choose a public place and tell a friend where you&apos;re going.</li>
            <li>Trust your instincts. If someone feels off, you can end the conversation or block them.</li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Blocking &amp; reporting</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              You can block users who harass you, spam you, or make you uncomfortable.
            </li>
            <li>
              Use the <strong>Report</strong> option on a profile, chat, or post to report abusive or inappropriate behavior.
            </li>
            <li>
              Reports are reviewed and may result in warnings, restrictions, or bans depending on the severity.
            </li>
          </ul>

          <h3 className="font-semibold mt-4 mb-2">Community rules (summary)</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>No hate speech, threats, or harassment.</li>
            <li>No spam, scams, or fake profiles.</li>
            <li>No explicit or illegal content.</li>
            <li>Respect other people&apos;s boundaries and consent at all times.</li>
          </ul>
        </section>

        {/* 9. TROUBLESHOOTING & FAQ */}
        <section id="faq" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            9. Troubleshooting &amp; FAQ
          </h2>

          <div className="space-y-3 text-gray-700">
            <div>
              <h3 className="font-semibold">
                Q: I didn&apos;t get my OTP / verification email.
              </h3>
              <p>
                A: Check your spam or junk folder. Make sure you entered the
                correct email address. Wait a minute and tap <strong>Resend code</strong> if
                available.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: Google login isn&apos;t working.
              </h3>
              <p>
                A: Make sure you are using the same Google account you used
                before. If the problem continues, try logging in with email and
                password or contact support.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: I&apos;m not seeing any matches or nearby users.
              </h3>
              <p>
                A: Make sure your location is turned on and your distance or
                filters are not too strict. Try expanding your age range or
                distance in Discover.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: MicroBuzz shows a blank page or doesn&apos;t start.
              </h3>
              <p>
                A: Refresh the page once, allow camera and location permissions,
                and ensure your internet connection is stable. If it still
                doesn&apos;t work, contact support with screenshots if possible.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: My notifications open the wrong page or don&apos;t behave as expected.
              </h3>
              <p>
                A: Refresh the app or website and try again. If a notification
                keeps taking you to the wrong place, report the issue via
                support so it can be fixed.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: I want to change my email or password.
              </h3>
              <p>
                A: Check your <strong>Account</strong> or <strong>Settings</strong> page for options to
                update your login details. If that feature is not yet visible,
                contact support and we can assist.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">
                Q: I think my account was hacked or used without my permission.
              </h3>
              <p>
                A: Change your password immediately, log out of all devices if
                possible, and contact support so we can investigate.
              </p>
            </div>
          </div>
        </section>

        {/* 10. CONTACT & SUPPORT */}
        <section id="contact-support" className="bg-white border border-gray-200 rounded-2xl p-5 md:p-6 shadow-sm">
          <h2 className="text-lg md:text-xl font-semibold mb-3">
            10. Contact &amp; support
          </h2>
          <p className="text-gray-600 mb-3">
            If you still need help after reading this page, we&apos;re here for you.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              Use any in-app <strong>Help</strong> or <strong>Report a problem</strong> buttons if they are
              available on your version.
            </li>
            <li>
              You can also contact us by email (for example:{" "}
              <span className="font-mono">support@rombuzz.com</span> or the
              official email shown on the website).
            </li>
            <li>
              When contacting support, include:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>Your RomBuzz email (and username if you have one).</li>
                <li>Device type and browser/app version.</li>
                <li>A short description of the problem.</li>
                <li>Screenshots if possible.</li>
              </ul>
            </li>
          </ul>
          <p className="text-gray-600 mt-3">
            We aim to keep RomBuzz safe, friendly, and fun. Thank you for being
            part of the community.
          </p>
        </section>
      </div>
    </div>
  );
}
