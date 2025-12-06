/**
 * ============================================================================
 * 📁 File: Location.jsx
 * 🎯 Purpose: Explain RomBuzz location usage (App Store / Play Store compliant)
 *
 * This page clearly explains:
 * - Why RomBuzz needs location
 * - Which features depend on it
 * - How users can manage permissions
 * - Privacy and safety principles
 *
 * NOTE:
 * Use the same text for RomBuzz Mobile (iOS + Android).
 * ============================================================================
 */


export default function Location() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 text-sm md:text-base">
      <h1 className="text-2xl md:text-3xl font-bold mb-3">Location Settings</h1>
      <p className="text-gray-600 mb-6">
        RomBuzz uses your location to provide real-time matching, accurate
        distance-based suggestions, and fair midpoint calculations. This page
        explains exactly how your location is used and which features depend on
        it.
      </p>

      {/* WHY WE USE LOCATION */}
      <section className="mb-8 p-5 bg-white border rounded-xl shadow-sm">
        <h2 className="text-lg md:text-xl font-semibold mb-2">
          Why RomBuzz needs your location
        </h2>
        <p className="text-gray-700 mb-3">
          RomBuzz is built around real-world proximity and real-time matching.
          Your location helps us:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-gray-700">
          <li>Show you potential matches who are actually near you</li>
          <li>Activate MicroBuzz and scan real users within your radius</li>
          <li>Calculate the correct midpoint for Meet-in-the-Middle</li>
          <li>Improve match suggestions based on your region</li>
          <li>Prevent fake-location abuse and protect user safety</li>
        </ul>
      </section>

      {/* FEATURES THAT REQUIRE LOCATION */}
      <section className="mb-8 p-5 bg-white border rounded-xl shadow-sm">
        <h2 className="text-lg md:text-xl font-semibold mb-2">
          Features that use your location
        </h2>
        <p className="text-gray-700 mb-3">
          The following RomBuzz features depend on real-time geolocation:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>
            <strong>MicroBuzz</strong>  
            <span className="block text-gray-600">
              Uses location + selfie verification to find nearby users who are
              active at the same moment. Without location, MicroBuzz cannot start.
            </span>
          </li>

          <li>
            <strong>Discover Page (Nearby Profiles)</strong>
            <span className="block text-gray-600">
              Shows profiles sorted by distance and region-based preferences.
            </span>
          </li>

          <li>
            <strong>Meet-in-the-Middle</strong>
            <span className="block text-gray-600">
              Calculates a midpoint between you and your match and suggests fair,
              convenient locations to meet (parks, cafés, etc.).
            </span>
          </li>

          <li>
            <strong>Let’sBuzz Recommendations</strong>
            <span className="block text-gray-600">
              Helps personalize suggestions based on your city/region trends.
            </span>
          </li>

          <li>
            <strong>Safety & Authenticity</strong>
            <span className="block text-gray-600">
              Helps detect suspicious or abusive use of fake locations.
            </span>
          </li>
        </ul>

        <p className="text-gray-700 mt-4">
          🚫 <strong>RomBuzz does NOT track your movement</strong> or store precise
          location history.  
          📍 We only use your approximate coordinates at the moment you open or
          use a location-based feature.
        </p>
      </section>

      {/* PERMISSION CONTROL */}
      <section className="mb-8 p-5 bg-white border rounded-xl shadow-sm">
        <h2 className="text-lg md:text-xl font-semibold mb-2">
          How to control your location permissions
        </h2>

        <h3 className="font-semibold mt-3 mb-1">On iPhone (iOS)</h3>
        <ul className="list-disc pl-5 text-gray-700 space-y-1">
          <li>Open Settings → Privacy → Location Services</li>
          <li>Find <strong>RomBuzz</strong> in the list</li>
          <li>Select:
            <ul className="list-disc pl-5 mt-1">
              <li><strong>While Using the App</strong> (recommended)</li>
              <li>Or <strong>Allow Once</strong> if you prefer</li>
            </ul>
          </li>
        </ul>

        <h3 className="font-semibold mt-4 mb-1">On Android</h3>
        <ul className="list-disc pl-5 text-gray-700 space-y-1">
          <li>Open Settings → Apps → RomBuzz → Permissions</li>
          <li>Tap <strong>Location</strong></li>
          <li>Select:
            <ul className="list-disc pl-5 mt-1">
              <li><strong>Allow only while using the app</strong> (recommended)</li>
              <li>Or <strong>Deny</strong> to turn off location</li>
            </ul>
          </li>
        </ul>

        <h3 className="font-semibold mt-4 mb-1">Web (Chrome / Safari / Edge)</h3>
        <ul className="list-disc pl-5 text-gray-700 space-y-1">
          <li>
            Your browser will ask for permission when RomBuzz needs location.
          </li>
          <li>Click <strong>Allow</strong> to enable it.</li>
          <li>
            To change later: Check the lock icon in your browser’s address bar →
            Permissions → Location.
          </li>
        </ul>
      </section>

      {/* IMPACT OF DISABLING LOCATION */}
      <section className="mb-8 p-5 bg-white border rounded-xl shadow-sm">
        <h2 className="text-lg md:text-xl font-semibold mb-2">
          What happens if you turn off location?
        </h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-2">
          <li>MicroBuzz will not start</li>
          <li>Nearby Discover results will be inaccurate or empty</li>
          <li>You cannot use Meet-in-the-Middle calculations</li>
          <li>Distance information on profiles will be hidden</li>
          <li>Matches may appear from the wrong regions</li>
        </ul>

        <p className="mt-3 text-gray-700">
          We recommend enabling **“Allow While Using App”** for the best RomBuzz
          experience.
        </p>
      </section>

      {/* PRIVACY */}
      <section className="mb-8 p-5 bg-white border rounded-xl shadow-sm">
        <h2 className="text-lg md:text-xl font-semibold mb-2">Privacy & Safety</h2>
        <p className="text-gray-700 mb-2">
          Your location is processed securely and never shared with other users
          without your consent. Only approximate distance (e.g. “5 miles away”)
          is shown — never your exact coordinates.
        </p>

        <ul className="list-disc pl-5 text-gray-700 space-y-1">
          <li>We do NOT store long-term location history</li>
          <li>We do NOT track your movement</li>
          <li>We do NOT share your location with third parties</li>
          <li>You remain in control of permissions at all times</li>
        </ul>
      </section>

      <p className="text-gray-600 mt-8">
        If you have any questions about how RomBuzz uses location, please visit
        our Help Center or contact support at{" "}
        <span className="font-mono">support@rombuzz.com</span>.
      </p>
    </div>
  );
}
