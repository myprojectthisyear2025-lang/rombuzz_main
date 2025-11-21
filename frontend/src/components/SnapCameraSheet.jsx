// AFTER: src/components/SnapCameraSheet.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * ============================================================
 * 📸 SnapCameraSheet (RomBuzz Premium Snapchat-style camera)
 *
 * Behavior:
 * - Fullscreen overlay when `open` is true
 * - Live camera preview (front/back toggle)
 * - Flash:
 *    • Back camera → tries to use real torch if supported
 *    • Front camera → white-screen flash effect when taking photo
 * - Mood filters (exclusive Snapchat-style slide filters):
 *    • Natural
 *    • Flirty Mode
 *    • Cute Mode
 *    • Mystery Mode
 *    • Calm Vibes
 *    • Romantic Glow
 *    • Portrait Blur
 * - Pick photo from gallery instead of camera
 * - After capture:
 *    • "View once"  vs  "Keep in chat" toggle
 *    • Add caption text
 *    • AI-style caption suggestions (client-side)
 *    • Simple toolbar buttons: Text, Draw, Sticker, Crop, Close (draw/sticker/crop show "coming soon" alert for now)
 *    • Big SEND button
 *
 * Payload back to parent (ChatWindow) via onSend:
 *   {
 *     type: "image",
 *     url: string,
 *     ephemeral: { mode: "once" | "keep" },
 *     filter: { key: string, mood: string, label: string },
 *     caption?: string,
 *     aiCaption?: string,
 *     source: "camera" | "gallery"
 *   }
 *
 * Props:
 *   open: boolean
 *   onClose(): void
 *   onSend(payload): Promise<void>
 *   cloudName: string         // Cloudinary cloud
 *   uploadPreset: string      // Cloudinary unsigned preset
 *   defaultViewOnce?: boolean // defaults to true
 * ============================================================
 */

const MOOD_FILTERS = [
  {
    key: "natural",
    label: "Natural",
    mood: "none",
    css: "none",
    overlay:
      "bg-gradient-to-t from-black/30 via-transparent to-transparent",
  },
  {
    key: "flirty",
    label: "Flirty Mode",
    mood: "flirty",
    css: "saturate(1.35) contrast(1.1) brightness(1.05)",
    overlay:
      "bg-gradient-to-t from-rose-500/35 via-transparent to-transparent",
  },
  {
    key: "cute",
    label: "Cute Mode",
    mood: "cute",
    css: "saturate(1.4) brightness(1.08)",
    overlay:
      "bg-gradient-to-t from-pink-400/35 via-transparent to-transparent",
  },
  {
    key: "mystery",
    label: "Mystery Mode",
    mood: "mystery",
    css: "contrast(1.2) brightness(0.9) saturate(0.95)",
    overlay:
      "bg-gradient-to-t from-black/50 via-purple-900/40 to-transparent",
  },
  {
    key: "calm",
    label: "Calm Vibes",
    mood: "calm",
    css: "saturate(0.9) brightness(1.02)",
    overlay:
      "bg-gradient-to-t from-sky-500/35 via-transparent to-transparent",
  },
  {
    key: "romantic",
    label: "Romantic Glow",
    mood: "romantic",
    css: "saturate(1.25) contrast(1.05) hue-rotate(10deg)",
    overlay:
      "bg-gradient-to-t from-amber-400/40 via-transparent to-transparent",
  },
  {
    key: "portrait",
    label: "Portrait Blur",
    mood: "portrait",
    css: "blur(1px) contrast(1.12) saturate(1.15)",
    overlay:
      "bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0)_0,_rgba(0,0,0,0.4)_65%)]",
  },
];

// Simple "AI-style" caption suggestions, grouped by mood
const CAPTION_SUGGESTIONS = {
  flirty: [
    "Caught in your vibe 😏",
    "You can’t handle this glow",
    "This is a trouble face 😈",
  ],
  cute: [
    "Just a soft little chaos ✨",
    "Too cute to be casual",
    "This is my ‘hi’ face 🙈",
  ],
  mystery: [
    "Read my eyes, not my texts",
    "You weren’t ready for this one",
    "Guess what I’m thinking…",
  ],
  calm: [
    "Soft mood, soft heart",
    "Floating through the day",
    "Peace looks good on me",
  ],
  romantic: [
    "This lighting hits different",
    "Already imagining us here",
    "Romantic problems only 💘",
  ],
  portrait: [
    "Portrait mode: feelings on",
    "Blurred world, focused heart",
    "Look at me, not the chaos",
  ],
  default: [
    "Missing you already",
    "This is your sign to text me",
    "Main character check 🎬",
  ],
};

const pickCaption = (moodKey) => {
  const group =
    CAPTION_SUGGESTIONS[moodKey] ||
    CAPTION_SUGGESTIONS.default;
  return group[Math.floor(Math.random() * group.length)];
};

function SnapCameraSheet({
  open,
  onClose,
  onSend,
  cloudName,
  uploadPreset,
  defaultViewOnce = true,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [usingFront, setUsingFront] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [mode, setMode] = useState("capture"); // "capture" | "review"
  const [viewOnce, setViewOnce] = useState(!!defaultViewOnce);

  const [activeFilterKey, setActiveFilterKey] = useState("natural");

  const [screenFlash, setScreenFlash] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [capturedBlob, setCapturedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [source, setSource] = useState("camera"); // "camera" | "gallery"

  const [caption, setCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  // Clean up ObjectURL when preview changes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Start / stop camera when sheet opens/closes
  useEffect(() => {
    if (open) {
      setMode("capture");
      setCaption("");
      setAiCaption("");
      setErrorMsg("");
      startCamera(usingFront);
    } else {
      stopCamera();
      setCapturedBlob(null);
      setPreviewUrl("");
      setTorchOn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restart camera when flipping front/back while in capture mode
  useEffect(() => {
    if (!open || mode !== "capture") return;
    startCamera(usingFront);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingFront]);

  const getActiveFilter = () =>
    MOOD_FILTERS.find((f) => f.key === activeFilterKey) || MOOD_FILTERS[0];

  const startCamera = async (front = true) => {
    try {
      stopCamera();
      setIsReady(false);
      setErrorMsg("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg("Camera not available on this device.");
        return;
      }

      const constraints = {
        video: {
          facingMode: front ? "user" : "environment",
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(
        constraints
      );
      streamRef.current = stream;

      const track = stream
        .getVideoTracks?.()[0];

      // Check if torch is supported whenever we use the back camera
      if (!front && track?.getCapabilities) {
        const caps = track.getCapabilities();
        setTorchSupported(!!caps.torch);
      } else {
        setTorchSupported(false);
        setTorchOn(false);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
      }
      setIsReady(true);
    } catch (err) {
      console.error("Camera start failed", err);
      setErrorMsg("Could not open camera.");
    }
  };

  const stopCamera = () => {
    try {
      const s = streamRef.current;
      if (s) {
        s.getTracks?.().forEach((t) => t.stop());
      }
    } catch {}
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchSupported(false);
    setTorchOn(false);
  };

  const toggleTorch = async () => {
    if (usingFront) {
      // front "flash" is handled as a white overlay when taking photo
      // toggling here just sets a visual state
      setTorchOn((v) => !v);
      return;
    }
    try {
      const track = streamRef.current
        ?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch (e) {
      console.warn("Torch not supported / failed", e);
      setTorchSupported(false);
      setTorchOn(false);
    }
  };

  const takePhotoBlob = async () => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement("canvas");
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");

    const filterCss = getActiveFilter().css;
    if (filterCss && filterCss !== "none") {
      // approximate filter by drawing normally; true CSS filter is on video element only
      // (this is a visual match, not pixel-perfect)
    }
    ctx.drawImage(video, 0, 0, vw, vh);

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/jpeg",
        0.92
      );
    });
  };

  const uploadToCloudinary = async (fileOrBlob) => {
    if (!cloudName || !uploadPreset) {
      throw new Error("Cloudinary config missing");
    }
    const form = new FormData();
    form.append("file", fileOrBlob);
    form.append("upload_preset", uploadPreset);

    const r = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      {
        method: "POST",
        body: form,
      }
    );
    const j = await r.json();
    if (!j.secure_url) {
      console.error("Cloudinary upload error:", j);
      throw new Error("Cloudinary upload failed");
    }
    return j.secure_url;
  };

  const handleCapture = async () => {
    if (!isReady) return;

    setScreenFlash(true);
    setTimeout(() => setScreenFlash(false), 120);

    const blob = await takePhotoBlob();
    if (!blob) {
      setErrorMsg("Could not capture photo.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const url = URL.createObjectURL(blob);
    setCapturedBlob(blob);
    setPreviewUrl(url);
    setSource("camera");
    setMode("review");
  };

  const handlePickFromGallery = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const url = URL.createObjectURL(file);
    setCapturedBlob(file);
    setPreviewUrl(url);
    setSource("gallery");
    setMode("review");
  };

  const handleSend = async () => {
    if (!capturedBlob || isUploading) return;
    try {
      setIsUploading(true);
      const url = await uploadToCloudinary(capturedBlob);

      const filter = getActiveFilter();
      const payload = {
        type: "image",
        url,
        ephemeral: viewOnce
          ? { mode: "once" }
          : { mode: "keep" },
        filter: {
          key: filter.key,
          mood: filter.mood,
          label: filter.label,
        },
        caption: caption.trim() || undefined,
        aiCaption: aiCaption || undefined,
        source,
      };

      await onSend(payload);
      // reset + close
      setCapturedBlob(null);
      setPreviewUrl("");
      setCaption("");
      setAiCaption("");
      onClose?.();
    } catch (e) {
      console.error("Send snap failed", e);
      setErrorMsg("Upload failed. Try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl("");
    setCaption("");
    setAiCaption("");
    setMode("capture");
  };

  const handleAiCaption = () => {
    const filter = getActiveFilter();
    const m = filter.mood === "none" ? "default" : filter.mood;
    const suggestion = pickCaption(m);
    setAiCaption(suggestion);
    // if caption empty, fill it; else append
    setCaption((prev) =>
      prev ? `${prev} ${suggestion}` : suggestion
    );
  };

  const closeSheet = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl("");
    setCaption("");
    setAiCaption("");
    setMode("capture");
    onClose?.();
  };

  if (!open) return null;

  const filter = getActiveFilter();

  return (
    <div className="fixed inset-0 z-[999] bg-black/90 text-white flex flex-col">
      {/* HEADER BAR */}
      <div className="h-14 flex items-center justify-between px-4 pt-1">
        <button
          onClick={closeSheet}
          className="h-8 w-8 rounded-full bg-black/40 flex items-center justify-center text-lg"
          title="Close"
        >
          ✕
        </button>

        {mode === "capture" && (
          <div className="flex items-center gap-3">
            {/* Flash toggle */}
            <button
              onClick={toggleTorch}
              className={`h-8 px-3 rounded-full text-xs font-medium border ${
                torchOn
                  ? "bg-amber-400 text-black border-amber-300"
                  : "bg-black/40 border-white/30"
              }`}
            >
              {usingFront
                ? torchOn
                  ? "Front flash ON"
                  : "Front flash"
                : torchOn
                ? "Flash ON"
                : "Flash"}
            </button>

            {/* Gallery pick */}
            <label className="h-8 px-3 rounded-full bg-black/40 border border-white/20 text-xs font-medium flex items-center gap-1 cursor-pointer">
              <span>Gallery</span>
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handlePickFromGallery}
              />
            </label>
          </div>
        )}

        {mode === "review" && (
          <div className="flex items-center gap-2 text-xs">
            {/* Tiny hint for view-once vs keep */}
            <span className="px-2 py-1 rounded-full bg-black/40 border border-white/10">
              {viewOnce ? "View once" : "Keeps in chat"}
            </span>
          </div>
        )}
      </div>

      {/* MAIN CAMERA / PREVIEW AREA */}
      <div className="flex-1 flex items-center justify-center px-3 pb-3">
        <div className="relative w-full max-w-sm aspect-[9/16] rounded-[32px] overflow-hidden bg-black shadow-2xl">
          {/* Live camera (capture mode) */}
          {mode === "capture" && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  filter: filter.css,
                }}
              />
              {/* Mood overlay */}
              <div
                className={`absolute inset-0 pointer-events-none ${filter.overlay}`}
              />
              {/* subtle bottom gradient for UI */}
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />

              {/* screen flash */}
              {screenFlash && (
                <div className="absolute inset-0 bg-white/90 pointer-events-none" />
              )}

              {!isReady && !errorMsg && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
                  Opening camera…
                </div>
              )}

              {errorMsg && (
                <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-red-200">
                  {errorMsg}
                </div>
              )}
            </>
          )}

          {/* Captured preview (review mode) */}
          {mode === "review" && previewUrl && (
            <>
              <img
                src={previewUrl}
                alt="Preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className={`absolute inset-0 pointer-events-none ${filter.overlay}`}
              />
              <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
            </>
          )}
        </div>
      </div>

      {/* FILTER SLIDER (only in capture mode) */}
      {mode === "capture" && (
        <div className="mb-2 px-4">
          <div className="flex items-center justify-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {MOOD_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilterKey(f.key)}
                className={`px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap border ${
                  activeFilterKey === f.key
                    ? "bg-rose-500 text-white border-rose-400 shadow"
                    : "bg-black/40 border-white/20 text-gray-100 hover:bg-black/60"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* BOTTOM CONTROLS */}
      <div className="pb-[max(env(safe-area-inset-bottom),8px)] pt-2 px-6">
        {mode === "capture" && (
          <div className="flex items-center justify-between gap-6">
            {/* Flip camera */}
            <button
              onClick={() => setUsingFront((v) => !v)}
              className="h-12 w-12 rounded-full bg-black/40 border border-white/25 flex items-center justify-center text-xl"
              title="Flip camera"
            >
              🔁
            </button>

            {/* Shutter */}
            <button
              onClick={handleCapture}
              className="h-16 w-16 rounded-full bg-white flex items-center justify-center relative shadow-[0_0_0_4px_rgba(255,255,255,0.25)]"
              title="Take photo"
            >
              <div className="h-12 w-12 rounded-full bg-rose-500" />
            </button>

            {/* (reserved spot - could be for future video switch) */}
            <div className="h-12 w-12" />
          </div>
        )}

        {mode === "review" && (
          <>
            {/* Tools row */}
            <div className="flex items-center justify-between text-xs mb-2">
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-full bg-black/40 border border-white/15"
                  onClick={() => {
                    // Text is handled by the caption box below; this button just scrolls focus there.
                    const el = document.getElementById(
                      "rbz-snap-caption-input"
                    );
                    el?.focus();
                  }}
                >
                  Add text
                </button>
                <button
                  className="px-3 py-1.5 rounded-full bg-black/40 border border-white/15"
                  onClick={() =>
                    alert(
                      "Drawing tools are coming soon to RomBuzz ✏️"
                    )
                  }
                >
                  Draw
                </button>
                <button
                  className="px-3 py-1.5 rounded-full bg-black/40 border border-white/15"
                  onClick={() =>
                    alert(
                      "Stickers are coming soon to RomBuzz 💫"
                    )
                  }
                >
                  Sticker
                </button>
                <button
                  className="px-3 py-1.5 rounded-full bg-black/40 border border-white/15"
                  onClick={() =>
                    alert(
                      "Crop & edit are coming soon to RomBuzz ✂️"
                    )
                  }
                >
                  Crop
                </button>
              </div>

              <button
                onClick={handleRetake}
                className="px-3 py-1.5 rounded-full bg-black/40 border border-white/20 text-xs"
              >
                Retake
              </button>
            </div>

            {/* Caption + AI + view-once toggle */}
            <div className="space-y-2 mb-2">
              <div className="flex items-center gap-2">
                <input
                  id="rbz-snap-caption-input"
                  className="flex-1 px-3 py-2 rounded-full bg-black/40 border border-white/20 outline-none text-xs placeholder:text-gray-400"
                  placeholder="Add a cute caption…"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
                <button
                  onClick={handleAiCaption}
                  className="px-3 py-2 rounded-full bg-rose-500 text-xs font-semibold shadow hover:bg-rose-600"
                  title="Suggest a caption"
                >
                  ✨ Caption
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <div className="inline-flex rounded-full bg-black/40 border border-white/20 overflow-hidden">
                  <button
                    onClick={() => setViewOnce(true)}
                    className={`px-3 py-1 ${
                      viewOnce
                        ? "bg-rose-500 text-white"
                        : "text-gray-200"
                    }`}
                  >
                    View once
                  </button>
                  <button
                    onClick={() => setViewOnce(false)}
                    className={`px-3 py-1 ${
                      !viewOnce
                        ? "bg-rose-500 text-white"
                        : "text-gray-200"
                    }`}
                  >
                    Keep in chat
                  </button>
                </div>

                <div className="text-xs text-gray-300">
                  {aiCaption
                    ? "AI caption added"
                    : "Make it magical for them ✨"}
                </div>
              </div>
            </div>

            {/* SEND BUTTON */}
            <div className="flex items-center justify-center pb-1">
              <button
                onClick={handleSend}
                disabled={isUploading}
                className={`px-10 py-2.5 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2 ${
                  isUploading
                    ? "bg-gray-500 cursor-wait"
                    : "bg-rose-500 hover:bg-rose-600"
                }`}
              >
                {isUploading ? "Sending…" : "Send"}
                {!isUploading && "➤"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default SnapCameraSheet;
