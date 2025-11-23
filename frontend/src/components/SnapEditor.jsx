// src/components/SnapEditor.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * SnapEditor
 * ==========
 * Full-screen editor for snaps:
 *  - Text overlay (multiple, draggable, resize, rotate, colors, fonts)
 *  - Freehand drawing
 *  - Emoji stickers (draggable, scale, rotate)
 *  - Center zoom + crop (like Snapchat zoom, no pan yet)
 *  - Exports a single composited Blob via onApply(blob)
 *
 * Props:
 *  - open: boolean
 *  - imageUrl: string (ObjectURL or data URL from SnapCameraSheet preview)
 *  - initialMode: "text" | "draw" | "sticker" | "crop"
 *  - onCancel(): void
 *  - onApply(blob: Blob): void
 */

const TEXT_COLORS = ["#ffffff", "#ff4b8f", "#ffd447", "#7cf49a", "#7db7ff"];
const TEXT_FONTS = [
  { key: "sans", label: "Clean", css: "600 28px system-ui" },
  { key: "serif", label: "Classy", css: "600 28px 'Georgia', serif" },
  { key: "hand", label: "Hand", css: "600 28px 'Comic Sans MS', cursive" },
];

const DRAW_COLORS = ["#ff4b8f", "#ffd447", "#7cf49a", "#7db7ff", "#ffffff"];

const STICKER_SET = ["😏", "😊", "😍", "🔥", "😜", "😘", "💘", "💫", "👑"];

let idCounter = 1;
const nextId = () => String(idCounter++);

function SnapEditor({ open, imageUrl, initialMode = "text", onCancel, onApply }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  const [mode, setMode] = useState(initialMode);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ width: 1, height: 1 });

  const [zoom, setZoom] = useState(1); // center zoom for crop

  // Text layers
  const [texts, setTexts] = useState([]);
  const [activeTextId, setActiveTextId] = useState(null);

  // Drawing
  const [paths, setPaths] = useState([]); // {id,color,size,points:[{x,y}]}
  const [isDrawing, setIsDrawing] = useState(false);

  // Stickers
  const [stickers, setStickers] = useState([]); // {id,emoji,x,y,scale,rotation}
  const [activeStickerId, setActiveStickerId] = useState(null);

  // dragging
  const dragRef = useRef(null); // {type:"text"|"sticker", id, offsetX, offsetY}

  useEffect(() => {
    if (!open) {
      // reset when closed
      setMode(initialMode);
      setTexts([]);
      setPaths([]);
      setStickers([]);
      setZoom(1);
      setActiveTextId(null);
      setActiveStickerId(null);
      setImgLoaded(false);
    }
  }, [open, initialMode]);

  const handleImageLoaded = () => {
    if (!imgRef.current) return;
    setImgSize({
      width: imgRef.current.naturalWidth || 1080,
      height: imgRef.current.naturalHeight || 1920,
    });
    setImgLoaded(true);
  };

  // map client (x,y) to container normalized 0..1
  const clientToNormalized = (clientX, clientY) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
    return { x, y };
  };

  // ---------- TEXT ----------
  const addTextLayer = () => {
    const newText = {
      id: nextId(),
      x: 0.5,
      y: 0.4,
      value: "Your text",
      color: TEXT_COLORS[0],
      fontKey: TEXT_FONTS[0].key,
      size: 0.04, // relative to height
      rotation: 0,
    };
    setTexts((prev) => [...prev, newText]);
    setActiveTextId(newText.id);
    setMode("text");
  };

  const updateText = (id, patch) => {
    setTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const activeText = texts.find((t) => t.id === activeTextId) || null;

  const handleTextDragStart = (e, id) => {
    e.preventDefault();
    const isTouch = e.type === "touchstart";
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    const { x, y } = clientToNormalized(clientX, clientY);
    const layer = texts.find((t) => t.id === id);
    if (!layer) return;

    dragRef.current = {
      type: "text",
      id,
      offsetX: layer.x - x,
      offsetY: layer.y - y,
    };
    setActiveTextId(id);
  };

  // ---------- STICKERS ----------
  const addSticker = (emoji) => {
    const st = {
      id: nextId(),
      emoji,
      x: 0.5,
      y: 0.6,
      scale: 1,
      rotation: 0,
    };
    setStickers((prev) => [...prev, st]);
    setActiveStickerId(st.id);
    setMode("sticker");
  };

  const updateSticker = (id, patch) => {
    setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const activeSticker = stickers.find((s) => s.id === activeStickerId) || null;

  const handleStickerDragStart = (e, id) => {
    e.preventDefault();
    const isTouch = e.type === "touchstart";
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;

    const { x, y } = clientToNormalized(clientX, clientY);
    const layer = stickers.find((s) => s.id === id);
    if (!layer) return;

    dragRef.current = {
      type: "sticker",
      id,
      offsetX: layer.x - x,
      offsetY: layer.y - y,
    };
    setActiveStickerId(id);
  };

  // ---------- DRAW ----------
  const startDrawing = (e) => {
    if (mode !== "draw") return;
    e.preventDefault();
    const isTouch = e.type === "touchstart";
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const { x, y } = clientToNormalized(clientX, clientY);

    const newPath = {
      id: nextId(),
      color: DRAW_COLORS[0],
      size: 0.006, // relative thickness
      points: [{ x, y }],
    };
    setPaths((prev) => [...prev, newPath]);
    setIsDrawing(true);
  };

  const continueDrawing = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const isTouch = e.type === "touchmove";
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const { x, y } = clientToNormalized(clientX, clientY);

    setPaths((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const updated = { ...last, points: [...last.points, { x, y }] };
      return [...prev.slice(0, -1), updated];
    });
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  // ---------- GENERAL POINTER MOVE ----------
  const handlePointerMove = (e) => {
    if (isDrawing) {
      continueDrawing(e);
      return;
    }
    if (!dragRef.current) return;

    const isTouch = e.type === "touchmove";
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const clientY = isTouch ? e.touches[0].clientY : e.clientY;
    const { x, y } = clientToNormalized(clientX, clientY);
    const { type, id, offsetX, offsetY } = dragRef.current;

    if (type === "text") {
      updateText(id, { x: x + offsetX, y: y + offsetY });
    } else if (type === "sticker") {
      updateSticker(id, { x: x + offsetX, y: y + offsetY });
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    stopDrawing();
  };

  // ---------- EXPORT ----------
  const handleApply = () => {
    if (!imgLoaded || !imgRef.current) return;
    const { width, height } = imgSize;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // background: center zoom crop
    const cropWidth = width / zoom;
    const cropHeight = height / zoom;
    const sx = (width - cropWidth) / 2;
    const sy = (height - cropHeight) / 2;

    ctx.drawImage(
      imgRef.current,
      sx,
      sy,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height
    );

    // helper: convert visible normalized (0..1 in editor box) to image coords considering crop
    const normToImage = (nx, ny) => {
      const visibleLeft = 0.5 - 0.5 / zoom;
      const visibleTop = 0.5 - 0.5 / zoom;
      const visW = 1 / zoom;
      const visH = 1 / zoom;
      const ix = (visibleLeft + nx * visW) * width;
      const iy = (visibleTop + ny * visH) * height;
      return { x: ix, y: iy };
    };

    // draw paths
    paths.forEach((p) => {
      if (p.points.length < 2) return;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * height;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      p.points.forEach((pt, idx) => {
        const { x, y } = normToImage(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // draw texts
    texts.forEach((t) => {
      const { x, y } = normToImage(t.x, t.y);
      const fontDef = TEXT_FONTS.find((f) => f.key === t.fontKey) || TEXT_FONTS[0];
      const pxSize = t.size * height;
      const fontCss = fontDef.css.replace("28px", `${pxSize.toFixed(0)}px`);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.fillStyle = t.color;
      ctx.font = fontCss;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      wrapFillText(ctx, t.value, 0, 0, width * 0.8);
      ctx.restore();
    });

    // draw stickers (as big emoji)
    stickers.forEach((s) => {
      const { x, y } = normToImage(s.x, s.y);
      const baseSize = 0.08 * height * s.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((s.rotation * Math.PI) / 180);
      ctx.font = `${baseSize.toFixed(0)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.emoji, 0, 0);
      ctx.restore();
    });

    canvas.toBlob(
      (blob) => {
        if (blob) onApply(blob);
      },
      "image/jpeg",
      0.92
    );
  };

  if (!open) return null;

  const currentTextFont =
    TEXT_FONTS.find((f) => f.key === (activeText?.fontKey || "sans")) ||
    TEXT_FONTS[0];

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 text-white flex flex-col">
      {/* Top bar */}
      <div className="h-12 flex items-center justify-between px-4 pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full bg-black/60 border border-white/25 text-xs"
        >
          ✕ Close
        </button>
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => setMode("text")}
            className={`px-2 py-1 rounded-full border ${
              mode === "text" ? "bg-rose-500 border-rose-400" : "bg-black/60 border-white/25"
            }`}
          >
            ✏️ Text
          </button>
          <button
            onClick={() => setMode("draw")}
            className={`px-2 py-1 rounded-full border ${
              mode === "draw" ? "bg-rose-500 border-rose-400" : "bg-black/60 border-white/25"
            }`}
          >
            🎨 Draw
          </button>
          <button
            onClick={() => setMode("sticker")}
            className={`px-2 py-1 rounded-full border ${
              mode === "sticker" ? "bg-rose-500 border-rose-400" : "bg-black/60 border-white/25"
            }`}
          >
            🌟 Stickers
          </button>
          <button
            onClick={() => setMode("crop")}
            className={`px-2 py-1 rounded-full border ${
              mode === "crop" ? "bg-rose-500 border-rose-400" : "bg-black/60 border-white/25"
            }`}
          >
            ✂️ Crop
          </button>
        </div>
        <button
          onClick={handleApply}
          className="px-3 py-1.5 rounded-full bg-rose-500 text-xs font-semibold shadow"
        >
          Apply
        </button>
      </div>

      {/* Editor canvas */}
      <div className="flex-1 flex items-center justify-center px-3 pb-3">
        <div
          ref={containerRef}
          className="relative w-full max-w-sm aspect-[9/16] rounded-[32px] overflow-hidden bg-black shadow-2xl touch-none"
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        >
          {/* image + overlays grouped for zoom/crop */}
          <div
            className="absolute inset-0"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
            }}
            onMouseDown={mode === "draw" ? startDrawing : undefined}
            onTouchStart={mode === "draw" ? startDrawing : undefined}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Edit"
              onLoad={handleImageLoaded}
              className="w-full h-full object-cover"
            />

            {/* Draw SVG overlay */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {paths.map((p) => (
                <polyline
                  key={p.id}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={`${p.size * 100}%`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={p.points
                    .map((pt) => `${pt.x * 100},${pt.y * 100}`)
                    .join(" ")}
                />
              ))}
            </svg>

            {/* Text layers */}
            {texts.map((t) => (
              <div
                key={t.id}
                onMouseDown={(e) => handleTextDragStart(e, t.id)}
                onTouchStart={(e) => handleTextDragStart(e, t.id)}
                className={`absolute cursor-move select-none ${
                  t.id === activeTextId ? "drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]" : ""
                }`}
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${t.rotation}deg)`,
                  color: t.color,
                  fontWeight: 600,
                  fontFamily:
                    TEXT_FONTS.find((f) => f.key === t.fontKey)?.css.split(" ").slice(2).join(" ") ||
                    "system-ui",
                  fontSize: `${t.size * 100}vh`, // rough scaling, final render is canvas-perfect
                  maxWidth: "80%",
                  textAlign: "center",
                  pointerEvents: "auto",
                }}
              >
                {t.value}
              </div>
            ))}

            {/* Stickers */}
            {stickers.map((s) => (
              <div
                key={s.id}
                onMouseDown={(e) => handleStickerDragStart(e, s.id)}
                onTouchStart={(e) => handleStickerDragStart(e, s.id)}
                className="absolute cursor-move select-none"
                style={{
                  left: `${s.x * 100}%`,
                  top: `${s.y * 100}%`,
                  transform: `translate(-50%, -50%) scale(${s.scale}) rotate(${s.rotation}deg)`,
                  fontSize: "8vh",
                }}
              >
                {s.emoji}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="pb-[max(env(safe-area-inset-bottom),8px)] px-4 space-y-2 text-xs">
        {/* Mode-specific controls */}
        {mode === "text" && (
          <>
            <div className="flex gap-2 mb-1">
              <button
                onClick={addTextLayer}
                className="px-3 py-1.5 rounded-full bg-black/60 border border-white/20"
              >
                ➕ Add text
              </button>
              {activeText && (
                <input
                  className="flex-1 px-3 py-1.5 rounded-full bg-black/50 border border-white/20 outline-none"
                  value={activeText.value}
                  onChange={(e) => updateText(activeText.id, { value: e.target.value })}
                  placeholder="Type something cute…"
                />
              )}
            </div>

            {activeText && (
              <>
                <div className="flex items-center gap-2">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateText(activeText.id, { color: c })}
                      className={`h-6 w-6 rounded-full border ${
                        activeText.color === c ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {TEXT_FONTS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => updateText(activeText.id, { fontKey: f.key })}
                      className={`px-2 py-1 rounded-full border ${
                        activeText.fontKey === f.key
                          ? "bg-rose-500 border-rose-400"
                          : "bg-black/60 border-white/25"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span>Size</span>
                  <input
                    type="range"
                    min="0.02"
                    max="0.08"
                    step="0.005"
                    value={activeText.size}
                    onChange={(e) =>
                      updateText(activeText.id, { size: parseFloat(e.target.value) })
                    }
                    className="flex-1"
                  />
                  <span>Rotate</span>
                  <input
                    type="range"
                    min="-45"
                    max="45"
                    step="1"
                    value={activeText.rotation}
                    onChange={(e) =>
                      updateText(activeText.id, { rotation: parseFloat(e.target.value) })
                    }
                  />
                </div>
              </>
            )}
          </>
        )}

        {mode === "draw" && (
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    // change color of next path by adding dummy path with that color
                    setPaths((prev) => [...prev, { id: nextId(), color: c, size: 0.006, points: [] }]);
                  }}
                  className="h-6 w-6 rounded-full border border-white/20"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={() => setPaths([])}
              className="px-3 py-1.5 rounded-full bg-black/60 border border-white/25"
            >
              Clear drawing
            </button>
          </div>
        )}

        {mode === "sticker" && (
          <div className="flex items-center justify-between">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {STICKER_SET.map((em) => (
                <button
                  key={em}
                  onClick={() => addSticker(em)}
                  className="h-8 w-8 rounded-full bg-black/60 border border-white/25 flex items-center justify-center text-lg"
                >
                  {em}
                </button>
              ))}
            </div>
            {activeSticker && (
              <div className="flex items-center gap-2 ml-2">
                <span>Size</span>
                <input
                  type="range"
                  min="0.6"
                  max="1.8"
                  step="0.05"
                  value={activeSticker.scale}
                  onChange={(e) =>
                    updateSticker(activeSticker.id, {
                      scale: parseFloat(e.target.value),
                    })
                  }
                />
                <span>Rotate</span>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={activeSticker.rotation}
                  onChange={(e) =>
                    updateSticker(activeSticker.id, {
                      rotation: parseFloat(e.target.value),
                    })
                  }
                />
              </div>
            )}
          </div>
        )}

        {mode === "crop" && (
          <div className="flex items-center gap-3">
            <span className="text-xs">Zoom & crop (center)</span>
            <input
              type="range"
              min="1"
              max="2.2"
              step="0.02"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Helper: wrap text in canvas fillText with a max width
 */
function wrapFillText(ctx, text, x, y, maxWidth, lineHeight = 1.2) {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  const totalHeight = lines.length * ctx.measureText("M").width * lineHeight;
  let ty = y - totalHeight / 2 + ctx.measureText("M").width / 2;
  lines.forEach((l) => {
    ctx.fillText(l.trim(), x, ty);
    ty += ctx.measureText("M").width * lineHeight;
  });
}

export default SnapEditor;
