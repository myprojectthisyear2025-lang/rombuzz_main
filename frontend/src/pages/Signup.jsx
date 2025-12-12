// src/pages/Signup.jsx
import { GoogleLogin } from "@react-oauth/google";
import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

//const API_BASE = "http://localhost:4000/api";
//const API_BASE = process.env.REACT_APP_API_BASE || "https://rombuzz-api.onrender.com/api";
import { API_BASE } from "../config";

// ✅ Require exact Google Client ID from env (must match backend GOOGLE_CLIENT_ID)
const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
if (!CLIENT_ID) {
  console.error("❌ Missing REACT_APP_GOOGLE_CLIENT_ID — must match backend GOOGLE_CLIENT_ID");
}

export default function Signup({ setUser }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [step, setStep] = useState(1);

  const codeInputRef = useRef(null);

  // Countdown for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Send verification code
  const sendCode = async () => {
    setError("");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setError("Please enter a valid email address.");
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/auth/send-code`, { email });
      if (res.data.success) {
        setSuccess("Verification code sent to your email. Please check your inbox/spam folder.");
        setStep(2);
        setCountdown(60);
        setTimeout(() => codeInputRef.current?.focus(), 200);
      } else {
        setError(res.data.error || "Failed to send code.");
      }
    } catch (e) {
      setError(e.response?.data?.error || "Error sending verification code.");
    } finally {
      setLoading(false);
    }
  };

   // Verify the code (real backend verification)
  const verifyCode = async () => {
    setError("");
    setSuccess("");

    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();

    if (!trimmedCode || trimmedCode.length !== 6) {
      return setError("Please enter the 6-digit code.");
    }

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/auth/register`, {
        email: trimmedEmail.toLowerCase(),
        code: trimmedCode,
      });

      if (!res.data || !res.data.token || !res.data.user) {
        throw new Error("Invalid verification response.");
      }

      setSuccess("Email verified successfully! Redirecting...");
      setTimeout(() => {
        navigate("/register", {
          state: { verifiedEmail: trimmedEmail, from: "signup" },
          replace: true,
        });
      }, 800);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Invalid or expired verification code.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };


 // ✅ FIXED Google Signup Handler
const handleGoogleSignup = async (response) => {
  setError("");
  setLoading(true);
  try {
    console.log("🔍 GOOGLE RESPONSE RECEIVED:", response);
    console.log("🔍 Using Google CLIENT_ID:", CLIENT_ID);
    console.log("🔍 CREDENTIAL EXISTS?", !!response.credential);
    
    const res = await axios.post(`${API_BASE}/auth/google`, {
      token: response.credential,
    });
    
    console.log("🔍 FULL BACKEND RESPONSE:", JSON.stringify(res.data, null, 2)); // CHANGED THIS LINE
    console.log("🔍 RESPONSE STATUS:", res.data.status); // ADD THIS
    console.log("🔍 USER PROFILE COMPLETE:", res.data.user?.profileComplete); // ADD THIS
    console.log("🔍 IS NEW USER?", res.data.user?.createdAt); // ADD THIS
    
    const { status, token, user } = res.data || {};
    if (!token || !user) throw new Error("Invalid response from server");

   
// 🧹 Clear any stale data first
localStorage.removeItem("user");
localStorage.removeItem("token");

// ✅ Save fresh token + user
localStorage.setItem("token", token);
localStorage.setItem("user", JSON.stringify(user));
if (setUser) setUser(user);

// ✅ Redirect based on backend status
console.log("🔄 FINAL CHECK - status:", status, "profileComplete:", user?.profileComplete);
if (status === "incomplete_profile") {
  console.log("🔄 Redirecting to CompleteProfile");
  setTimeout(() => {
    navigate("/register", { replace: true });
  }, 100);
} else {
  console.log("🔄 Redirecting to Discover - status was:", status);
  setTimeout(() => {
    navigate("/discover", { replace: true });
  }, 100);
}
  } catch (e) {
    console.error("Google signup error:", e);
    setError(
      e.response?.data?.error ||
        e.message ||
        "Google signup failed. Please try again."
    );
  } finally {
    setLoading(false);
  }
};



  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-500 to-red-500 px-4">
      <div className="bg-white shadow-2xl rounded-2xl w-full max-w-md p-8 text-center">
        <h1 className="text-3xl font-bold text-pink-600 mb-4">
          Create Your RomBuzz Account
        </h1>
        {error && <p className="text-red-600 mb-2">{error}</p>}
        {success && <p className="text-green-600 mb-2">{success}</p>}

        {/* STEP 1 — Enter email */}
        {step === 1 && (
          <>
            <input
              type="email"
              placeholder="Enter your email"
              className="w-full p-3 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-pink-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              onClick={sendCode}
              disabled={loading || countdown > 0}
              className="w-full py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition mb-3"
            >
              {loading
                ? "Sending..."
                : countdown > 0
                ? `Resend in ${countdown}s`
                : "Send Verification Code"}
            </button>

            <div className="relative text-center my-4">
              <div className="border-t border-gray-300 w-full mb-3"></div>
              <span className="bg-white px-3 text-gray-500 text-sm">or</span>
            </div>

            <div className="flex flex-col gap-3">
            

              <GoogleLogin
                  clientId={CLIENT_ID} // ✅ Explicitly bind the same Client ID
                  onSuccess={handleGoogleSignup}
                  onError={() => setError("Google signup failed")}
                  text="signup_with"
                  shape="pill"
                  width="330"
                  size="large"
                  theme="filled_pink"
                />

            </div>

            <p className="mt-6 text-sm text-gray-600">
              Already have an account?{" "}
              <span
                className="text-pink-600 font-semibold cursor-pointer hover:underline"
                onClick={() => navigate("/login")}
              >
                Login
              </span>
            </p>
          </>
        )}

        {/* STEP 2 — Enter code */}
        {step === 2 && (
          <>
            <input
              type="text"
              placeholder="Enter 6-digit code"
              className="w-full p-3 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-pink-400 text-center tracking-widest text-lg"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              ref={codeInputRef}
              maxLength={6}
            />
            <button
              onClick={verifyCode}
              disabled={loading}
              className="w-full py-3 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition mb-3"
            >
              {loading ? "Verifying..." : "Verify Code"}
            </button>
            <button
              onClick={() => setStep(1)}
              className="text-gray-600 text-sm underline hover:text-pink-500"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
