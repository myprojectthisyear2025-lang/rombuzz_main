// frontend/src/pages/Upgrade.jsx
import React from "react";
import {
  FaStar,
  FaCrown,
  FaBolt,
  FaShieldAlt,
  FaInfinity,
} from "react-icons/fa";

export default function Upgrade() {
  return (
    <div className="min-h-screen pt-6 pb-20 px-3 md:px-8 bg-gradient-to-br from-pink-50 via-rose-50 to-orange-50 text-gray-900">
      {/* HERO */}
      <div className="text-center mt-6 mb-10">
<h1 className="text-4xl md:text-5xl font-extrabold leading-normal bg-gradient-to-r from-pink-600 to-red-500 bg-clip-text text-transparent drop-shadow-sm">
          Upgrade Your Buzz
        </h1>
        <p className="text-gray-600 text-lg mt-3 max-w-2xl mx-auto">
          Choose your vibe: stay Free, boost with RomBuzz+, or go all-in with
          Elite and sit at the top of every stack.
        </p>
      </div>

      {/* PLANS CONTAINER */}
      <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
        {/* ⭐ RomBuzz+ */}
        <div className="rounded-2xl bg-white shadow-xl border border-pink-200 p-6 hover:shadow-2xl transition">
          <div className="flex items-center gap-3 mb-3">
            <FaStar className="text-pink-500 text-3xl" />
            <h2 className="text-2xl font-bold text-pink-600">RomBuzz+</h2>
          </div>

          <p className="text-gray-600 mb-5">
            Perfect for people who want a boosted daily experience without going
            fully Elite.
          </p>

          <ul className="space-y-3 text-gray-700">
            <li className="flex items-center gap-2">
              <FaBolt className="text-pink-500" /> More daily right swipes
            </li>
            <li className="flex items-center gap-2">
              <FaShieldAlt className="text-pink-500" /> Priority in Discover
            </li>
            <li className="flex items-center gap-2">
              <FaBolt className="text-pink-500" /> Extra MicroBuzz requests
            </li>
            <li className="flex items-center gap-2">
              <FaInfinity className="text-pink-500" /> Unlimited rewinds
            </li>
          </ul>

          <button className="w-full mt-6 py-3 rounded-xl bg-pink-600 text-white font-semibold hover:bg-pink-700 transition">
            Get RomBuzz+
          </button>
        </div>

        {/* 👑 RomBuzz Elite */}
        <div className="rounded-2xl bg-gradient-to-b from-yellow-200 via-amber-100 to-orange-50 shadow-xl border border-yellow-300 p-6 hover:shadow-2xl transition transform md:scale-105">
          <div className="flex items-center gap-3 mb-3">
            <FaCrown className="text-yellow-600 text-3xl" />
            <h2 className="text-2xl font-extrabold text-yellow-700">
              RomBuzz Elite
            </h2>
          </div>

          <p className="text-gray-700 mb-5">
            For users who want the absolute highest visibility and the best
            possible RomBuzz experience.
          </p>

          <ul className="space-y-3 text-gray-700">
            <li className="flex items-center gap-2">
              <FaCrown className="text-yellow-600" /> Elite profile highlighting
            </li>
            <li className="flex items-center gap-2">
              <FaStar className="text-yellow-600" /> Top priority in Discover
            </li>
            <li className="flex items-center gap-2">
              <FaBolt className="text-yellow-600" /> Max-boosted MicroBuzz
              radius
            </li>
            <li className="flex items-center gap-2">
              <FaInfinity className="text-yellow-600" /> Unlimited everything
            </li>
            <li className="flex items-center gap-2">
              <FaShieldAlt className="text-yellow-600" /> Advanced safety tools
            </li>
          </ul>

          <button className="w-full mt-6 py-3 rounded-xl bg-yellow-600 text-white font-bold hover:bg-yellow-700 transition">
            Go Elite
          </button>
        </div>
      </div>

      {/* COMPARISON TABLE */}
      <div className="max-w-5xl mx-auto mt-12">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-6 text-rose-700">
          Compare plans
        </h2>

        <div className="overflow-x-auto rounded-2xl bg-white/80 shadow-md border border-rose-100">
          <div className="min-w-[680px]">
            {/* Header row */}
            <div className="grid grid-cols-4 text-sm md:text-base font-semibold border-b border-rose-100">
              <div className="px-4 py-3 text-left text-gray-500">Feature</div>
              <div className="px-4 py-3 text-center text-gray-800">Free</div>
              <div className="px-4 py-3 text-center text-pink-600">
                RomBuzz+
              </div>
              <div className="px-4 py-3 text-center text-yellow-700">
                Elite
              </div>
            </div>

            {/* Rows */}
            {[
              {
                label: "Daily right swipes",
                free: "Limited",
                plus: "Boosted",
                elite: "Maxed",
              },
              {
                label: "Priority in Discover",
                free: "Standard",
                plus: "Higher",
                elite: "Top of stack",
              },
              {
                label: "MicroBuzz visibility",
                free: "Normal",
                plus: "Boosted",
                elite: "Max-boosted",
              },
              {
                label: "Rewinds",
                free: "None",
                plus: "Unlimited",
                elite: "Unlimited",
              },
              {
                label: "Profile highlighting",
                free: "None",
                plus: "Soft glow",
                elite: "Elite glow",
              },
              {
                label: "Support level",
                free: "Standard",
                plus: "Priority",
                elite: "VIP",
              },
            ].map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-4 border-t border-rose-50 text-xs md:text-sm"
              >
                <div className="px-4 py-3 font-medium text-gray-700">
                  {row.label}
                </div>
                <div className="px-4 py-3 text-center text-gray-600">
                  {row.free}
                </div>
                <div className="px-4 py-3 text-center text-pink-600 font-semibold">
                  {row.plus}
                </div>
                <div className="px-4 py-3 text-center text-yellow-700 font-semibold">
                  {row.elite}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER MESSAGE */}
      <p className="text-center text-gray-600 text-sm mt-12">
        Payments & verification coming soon. Your tier will automatically unlock
        extra features across Discover, MicroBuzz, Chat & more.
      </p>
    </div>
  );
}
