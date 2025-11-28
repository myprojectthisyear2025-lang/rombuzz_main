// =============================================
// File: src/components/FullscreenViewer.jsx
// Fullscreen viewer for snapped media (image/video),
// with:
//  - swipe-down to close
//  - swipe left/right to move between media
//  - pinch + double-tap zoom (images)
//  - auto-dismiss for view-once messages.
// =============================================

import React, { useEffect, useRef, useState } from "react";

/**
 * Props
 * - open: boolean
 * - messages: array of media messages [{ id, type:"image"|"video", url, ... }]
 * - index: number  (current media index inside messages)
 * - onIndexChange: (nextIndex:number) => void
 * - onClose: () => void
 * - onViewed?: (id) => void // called for view-once messages
 */
export function FullscreenViewer({
  open,
  messages = [],
  index = 0,
  onIndexChange,
  onClose,
  onViewed,
}) {
  const timerRef = useRef(null);
  const vidRef = useRef(null);

  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);

  const gestureRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    mode: null, // "horizontal" | "vertical"
    lastX: 0,
    lastY: 0,
  });

  const pinchRef = useRef({
    initialDistance: 0,
    initialScale: 1,
  });

  const lastTapRef = useRef(0);

  const total = messages.length || 0;
  const safeIndex =
    total === 0 ? 0 : Math.min(Math.max(index || 0, 0), total - 1);
  const message = total ? messages[safeIndex] : null;

  // helper for pinch distance
  const dist = (t1, t2) =>
    Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  // reset zoom/offset when media changes or viewer opens
  useEffect(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
  }, [safeIndex, open]);

  // view-once auto-dismiss logic
  useEffect(() => {
    if (!open || !message) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (message?.ephemeral?.mode === "once") {
      if (message.type === "video") {
        const v = vidRef.current;
        if (!v) return;
        const onEnd = () => {
          onViewed?.(message.id);
          onClose?.();
        };
        v.addEventListener("ended", onEnd);
        return () => v.removeEventListener("ended", onEnd);
      } else {
        timerRef.current = setTimeout(() => {
          onViewed?.(message.id);
          onClose?.();
        }, 4000);
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      }
    }
  }, [open, message, onClose, onViewed]);

  if (!open || !message) return null;

  const goTo = (dir) => {
    if (!total) return;
    let next = safeIndex + dir;
    if (next < 0) next = 0;
    if (next > total - 1) next = total - 1;
    if (next !== safeIndex) onIndexChange?.(next);
  };

  // ─── swipe gestures (whole screen, only when zoom == 1) ───────────
  const handleGestureStart = (e) => {
    if (!e.touches || e.touches.length !== 1 || scale !== 1) return;
    const t = e.touches[0];
    gestureRef.current = {
      active: true,
      startX: t.clientX,
      startY: t.clientY,
      mode: null,
      lastX: 0,
      lastY: 0,
    };
  };

  const handleGestureMove = (e) => {
    const g = gestureRef.current;
    if (!g.active || !e.touches || e.touches.length !== 1 || scale !== 1)
      return;
    const t = e.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    if (!g.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.mode = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }

    g.lastX = dx;
    g.lastY = dy;

    if (g.mode === "vertical") {
      setTranslateY(dy);
    } else {
      setTranslateX(dx);
    }
  };

  const handleGestureEnd = () => {
    const g = gestureRef.current;
    if (!g.active) return;
    gestureRef.current.active = false;

    const threshold = 80;

    if (scale === 1 && g.mode === "vertical" && Math.abs(g.lastY) > threshold) {
      onClose?.();
    } else if (
      scale === 1 &&
      g.mode === "horizontal" &&
      Math.abs(g.lastX) > threshold
    ) {
      const dir = g.lastX < 0 ? 1 : -1; // left swipe → next, right → prev
      goTo(dir);
    }

    setTranslateX(0);
    setTranslateY(0);
    gestureRef.current = {
      active: false,
      startX: 0,
      startY: 0,
      mode: null,
      lastX: 0,
      lastY: 0,
    };
  };

  // ─── pinch & double-tap zoom for IMAGES ───────────────────────────
  const handleImageTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [t1, t2] = e.touches;
      pinchRef.current.initialDistance = dist(t1, t2);
      pinchRef.current.initialScale = scale;
    }
  };

  const handleImageTouchMove = (e) => {
    if (e.touches && e.touches.length === 2) {
      const [t1, t2] = e.touches;
      const d = dist(t1, t2);
      const { initialDistance, initialScale } = pinchRef.current;
      if (!initialDistance) return;
      let next = (d / initialDistance) * initialScale;
      if (next < 1) next = 1;
      if (next > 4) next = 4;
      setScale(next);
    }
  };

  const handleImageClick = (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < 250) {
      // double-tap
      setScale((prev) => (prev > 1.5 ? 1 : 2.5));
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 pt-12 md:pt-0"
      onClick={onClose}
    >
      {/* gesture layer */}
      <div
        className="absolute inset-0 grid place-items-center"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleGestureStart}
        onTouchMove={handleGestureMove}
        onTouchEnd={handleGestureEnd}
      >
        <div
          className="relative"
          style={{
            transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
            transition: gestureRef.current.active
              ? "none"
              : "transform 0.2s ease-out",
          }}
        >
          {message.type === "image" ? (
            <img
              src={message.url}
              alt=""
              className="max-w-[95vw] max-h-[75vh] md:max-h-[85vh] object-contain rounded-xl"
              onTouchStart={handleImageTouchStart}
              onTouchMove={handleImageTouchMove}
              onClick={handleImageClick}
            />
          ) : message.type === "video" ? (
            <video
              ref={vidRef}
              src={message.url}
              className="max-w-[95vw] max-h-[75vh] md:max-h-[85vh] rounded-xl"
              autoPlay
              controls
            />
          ) : (
            <div className="text-white/80">Unsupported message</div>
          )}

          {/* Close button inside frame */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 bg-black/60 backdrop-blur p-3 rounded-full text-white text-xl"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Top info bar */}
      <div className="absolute top-0 left-0 right-0 h-14 px-3 flex items-center justify-between text-white/90">
        <div className="text-sm flex items-center gap-2">
          {message.filter?.label && <span>{message.filter.label}</span>}
          {total > 1 && (
            <span className="text-xs text-white/60">
              {safeIndex + 1}/{total}
            </span>
          )}
        </div>
        <button
          className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
