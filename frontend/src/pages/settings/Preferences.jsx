// src/pages/settings/Preferences.jsx
import React, { useEffect, useState } from "react";
import { API_BASE } from "../../config";

const token = () =>
  localStorage.getItem("token") || sessionStorage.getItem("token") || "";

const DISTANCE_OPTIONS = [1, 5, 10, 25, 50, 100, 250, 500, 1000]; // km

export default function Preferences() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedTick, setSavedTick] = useState(0);

  const [genderPref, setGenderPref] = useState("everyone"); // "male" | "female" | "everyone"
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(40);
  const [discoverKm, setDiscoverKm] = useState(25);
  const [me, setMe] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/users/me`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load preferences");
        }

        setMe(data);

        const prefs = data.preferences || {};
        if (prefs.gender) setGenderPref(prefs.gender);
        if (Number(prefs.ageMin)) setAgeMin(Number(prefs.ageMin));
        if (Number(prefs.ageMax)) setAgeMax(Number(prefs.ageMax));
        if (Number(prefs.discoverDistanceKm))
          setDiscoverKm(Number(prefs.discoverDistanceKm));
      } catch (e) {
        console.error(e);
        setError(e.message || "Could not load preferences");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const clampAge = (v) => Math.min(100, Math.max(18, v));

  const handleSave = async () => {
    if (!me) return;
    if (ageMin > ageMax) {
      alert("Minimum age cannot be greater than maximum age.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const newPrefs = {
        ...(me.preferences || {}),
        gender: genderPref,
        ageMin: clampAge(ageMin),
        ageMax: clampAge(ageMax),
        discoverDistanceKm: discoverKm,
      };

      // Also keep the old `interestedIn` field in sync for legacy flows
      const interestedIn =
        genderPref === "male"
          ? ["male"]
          : genderPref === "female"
          ? ["female"]
          : ["male", "female"];

      const res = await fetch(`${API_BASE}/users/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          preferences: newPrefs,
          interestedIn,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save preferences");
      }

      // Update local snapshot + localStorage user for Discover / MicroBuzz
      setMe(data.user || { ...me, preferences: newPrefs });

      try {
        const authMe = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token()}` },
        }).then((r) => r.json());
        if (authMe?.user) {
          localStorage.setItem("user", JSON.stringify(authMe.user));
        }
      } catch {}

      setSavedTick(Date.now());
    } catch (e) {
      console.error(e);
      setError(e.message || "Could not save preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Loading preferences…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-rose-500 via-fuchsia-500 to-orange-400 text-white p-5 md:p-6 shadow-lg">
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute -bottom-16 -left-8 w-40 h-40 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] opacity-80 mb-1">
              match engine
            </div>
            <h1 className="text-2xl md:text-3xl font-black drop-shadow-sm">
              Preferences
            </h1>
            <p className="text-sm md:text-base text-rose-50/90 max-w-md mt-1">
              Tune how Discover and MicroBuzz behave. RomBuzz will only show
              people who fit your vibe, your distance, and your age window.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            {savedTick ? (
              <div className="flex items-center gap-2 text-xs bg-black/20 px-3 py-1.5 rounded-full">
                <span className="text-emerald-300 text-lg">●</span>
                <span>Preferences synced</span>
              </div>
            ) : (
              <div className="text-xs text-rose-50/90">
                Changes apply instantly to Discover and MicroBuzz.
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-white text-rose-600 px-4 py-2 text-sm font-semibold shadow-md hover:bg-rose-50 disabled:opacity-60"
            >
              <span>{saving ? "Saving…" : "Save preferences"}</span>
              <span>✨</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Who you want to see */}
      <div className="p-4 md:p-5 rounded-2xl bg-white/90 border border-rose-100 shadow-sm">
        <h2 className="text-base md:text-lg font-semibold text-gray-800 flex items-center gap-2">
          <span>💘 Who do you want to see?</span>
          <span className="text-[10px] uppercase tracking-[0.12em] bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full">
            discover + microbuzz
          </span>
        </h2>
        <p className="text-xs md:text-sm text-gray-500 mt-1">
          We’ll always respect this across Discover cards and MicroBuzz radar.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { value: "everyone", label: "Everyone", emoji: "🌈" },
            { value: "female", label: "Women", emoji: "💖" },
            { value: "male", label: "Men", emoji: "🔥" },
          ].map((opt) => {
            const active = genderPref === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setGenderPref(opt.value)}
                className={[
                  "px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-all",
                  active
                    ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white shadow-md scale-[1.02]"
                    : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100",
                ].join(" ")}
              >
                <span>{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Age range + Discover distance */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Age window */}
        <div className="p-4 md:p-5 rounded-2xl bg-white/90 border border-rose-100 shadow-sm">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span>🎂 Age range</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-gray-400">
              discover only
            </span>
          </h3>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            We’ll prioritize profiles whose age falls inside this window.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Min
              </label>
              <input
                type="number"
                min={18}
                max={100}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={ageMin}
                onChange={(e) =>
                  setAgeMin(clampAge(Number(e.target.value) || 18))
                }
              />
            </div>
            <div className="text-gray-400 mt-5">—</div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Max
              </label>
              <input
                type="number"
                min={18}
                max={100}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={ageMax}
                onChange={(e) =>
                  setAgeMax(clampAge(Number(e.target.value) || 18))
                }
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            People without a visible age may still appear, but they won’t be
            prioritized.
          </p>
        </div>

        {/* Discover distance */}
        <div className="p-4 md:p-5 rounded-2xl bg-white/90 border border-rose-100 shadow-sm">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span>📍 Discover distance</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-gray-400">
              tinder-style
            </span>
          </h3>
          <p className="text-xs md:text-sm text-gray-500 mt-1">
            Choose how far Discover should search. We&apos;ll try this first,
            then gently expand the radius if the pool is too small.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {DISTANCE_OPTIONS.map((km) => {
              const active = discoverKm === km;
              const label =
                km >= 1000 ? `${km / 1000}k km` : `${km} km`;
              return (
                <button
                  key={km}
                  type="button"
                  onClick={() => setDiscoverKm(km)}
                  className={[
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    active
                      ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white shadow-md scale-[1.05]"
                      : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] text-gray-400">
            Current radius:{" "}
            <span className="font-semibold text-gray-600">
              up to {discoverKm >= 1000 ? discoverKm / 1000 + "k" : discoverKm}{" "}
              km
            </span>
            . MicroBuzz ignores this and stays ultra-local.
          </p>
        </div>
      </div>

      {/* MicroBuzz explanation card */}
      <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-purple-900 via-indigo-900 to-pink-800 text-rose-50 shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="absolute -right-10 -top-10 w-36 h-36 rounded-full bg-pink-500/40 blur-3xl" />
          <div className="absolute -left-16 bottom-0 w-44 h-44 rounded-full bg-indigo-400/40 blur-3xl" />
        </div>
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
              <span>📡 MicroBuzz radius</span>
              <span className="text-[10px] uppercase tracking-[0.16em] bg-black/30 px-2 py-0.5 rounded-full">
                room-level only
              </span>
            </h3>
            <p className="text-xs md:text-sm text-rose-100 mt-1 max-w-md">
              MicroBuzz is hard-locked to about{" "}
              <b>0–100 meters</b>. Think: same café, same bar, same library,
              same cinema hall. This is enforced on the server so it always
              feels like real-time, in-the-room discovery.
            </p>
          </div>
          <div className="text-xs md:text-sm text-rose-100/80 bg-black/30 px-4 py-3 rounded-2xl border border-white/10 max-w-xs">
            Your Discover distance can go from “down the street” to “across the
            country”, but MicroBuzz will always stay ultra-local so every buzz
            feels magical and safe.
          </div>
        </div>
      </div>
    </div>
  );
}
