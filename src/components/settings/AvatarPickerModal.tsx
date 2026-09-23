import { useEffect, useRef, useState } from "react";
import { Camera, Minus, Plus, Upload, X, Loader2 } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import { AVATAR_PRESETS, MAX_AVATAR_UPLOAD_BYTES } from "@/lib/avatar-options";
import {
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  AVATAR_ZOOM_STEP,
  clampAvatarPan,
  cropAvatarFromImage,
  getAvatarEditorImageSize,
  loadImage,
} from "@/lib/avatar-upload";

const EDITOR_VIEWPORT = 280;
const PREVIEW_SIZE = 96;

interface AvatarPickerModalProps {
  open: boolean;
  name?: string | null;
  currentAvatar?: string | null;
  onClose: () => void;
  onSelect: (avatarUrl: string) => void;
}

type EditorState = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export function AvatarPickerModal({
  open,
  name,
  currentAvatar,
  onClose,
  onSelect,
}: AvatarPickerModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorSrcRef = useRef<string | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [preview, setPreview] = useState<string | null>(currentAvatar ?? null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const revokeEditorSrc = (src?: string | null) => {
    const target = src ?? editorSrcRef.current;
    if (target?.startsWith("blob:")) URL.revokeObjectURL(target);
    if (!src || editorSrcRef.current === src) editorSrcRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    setPreview(currentAvatar ?? null);
    setError(null);
    revokeEditorSrc();
    setEditor(null);
  }, [open, currentAvatar]);

  useEffect(() => {
    return () => {
      revokeEditorSrc();
    };
  }, []);

  if (!open) return null;

  const handleClose = () => {
    revokeEditorSrc();
    setEditor(null);
    onClose();
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose a JPG, PNG, or GIF image.");
      return;
    }

    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setError("Image must be 10MB or smaller.");
      return;
    }

    setProcessing(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = await loadImage(objectUrl);
      revokeEditorSrc();
      editorSrcRef.current = objectUrl;
      setEditor({
        src: objectUrl,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process that image.");
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateTransform = (next: Partial<Pick<EditorState, "zoom" | "offsetX" | "offsetY">>) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const zoom = next.zoom ?? prev.zoom;
      const { width, height } = getAvatarEditorImageSize(
        prev.naturalWidth,
        prev.naturalHeight,
        EDITOR_VIEWPORT,
        zoom,
      );
      const pan = clampAvatarPan(
        next.offsetX ?? prev.offsetX,
        next.offsetY ?? prev.offsetY,
        width,
        height,
        EDITOR_VIEWPORT,
      );
      return { ...prev, zoom, ...pan };
    });
  };

  const handleApply = async () => {
    if (editor) {
      setProcessing(true);
      setError(null);
      try {
        const dataUrl = await cropAvatarFromImage(
          editor.src,
          {
            zoom: editor.zoom,
            offsetX: editor.offsetX,
            offsetY: editor.offsetY,
          },
          { viewportSize: EDITOR_VIEWPORT },
        );
        revokeEditorSrc();
        setEditor(null);
        onSelect(dataUrl);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not process that image.");
      } finally {
        setProcessing(false);
      }
      return;
    }

    if (!preview) {
      setError("Choose a preset or upload an image.");
      return;
    }
    onSelect(preview);
    onClose();
  };

  const editorImageSize = editor
    ? getAvatarEditorImageSize(
        editor.naturalWidth,
        editor.naturalHeight,
        EDITOR_VIEWPORT,
        editor.zoom,
      )
    : null;

  const renderImageLayer = (size: number, circular: boolean) => {
    if (!editor || !editorImageSize) return null;
    const scale = size / EDITOR_VIEWPORT;
    const width = editorImageSize.width * scale;
    const height = editorImageSize.height * scale;
    const offsetX = editor.offsetX * scale;
    const offsetY = editor.offsetY * scale;

    return (
      <div
        className={`relative overflow-hidden bg-gray-900 ${circular ? "rounded-full" : "rounded-xl"}`}
        style={{ width: size, height: size }}
      >
        <img
          src={editor.src}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none pointer-events-none"
          style={{
            width,
            height,
            left: (size - width) / 2 + offsetX,
            top: (size - height) / 2 + offsetY,
          }}
        />
      </div>
    );
  };

  return (
    <ModalBackdrop open={open} onClose={handleClose} overlayClassName="z-[100]">
      <div
        className={`relative w-full bg-white rounded-xl border border-gray-200 shadow-xl p-5 ${
          editor ? "max-w-2xl" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1F2937]">
            {editor ? "File upload" : "Change Avatar"}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />

        {editor && editorImageSize ? (
          <>
            <div className="flex flex-col sm:flex-row items-center gap-5 mb-4">
              <div className="relative">
                <div
                  className="touch-none cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragRef.current = {
                      startX: e.clientX,
                      startY: e.clientY,
                      originX: editor.offsetX,
                      originY: editor.offsetY,
                    };
                  }}
                  onPointerMove={(e) => {
                    if (!dragRef.current) return;
                    updateTransform({
                      offsetX: dragRef.current.originX + (e.clientX - dragRef.current.startX),
                      offsetY: dragRef.current.originY + (e.clientY - dragRef.current.startY),
                    });
                  }}
                  onPointerUp={() => {
                    dragRef.current = null;
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null;
                  }}
                >
                  {renderImageLayer(EDITOR_VIEWPORT, false)}
                </div>

                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-sm">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={editor.zoom <= AVATAR_ZOOM_MIN}
                    onClick={() =>
                      updateTransform({
                        zoom: Math.max(AVATAR_ZOOM_MIN, editor.zoom - AVATAR_ZOOM_STEP * 4),
                      })
                    }
                    className="text-white/90 hover:text-white disabled:opacity-40"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="range"
                    min={AVATAR_ZOOM_MIN}
                    max={AVATAR_ZOOM_MAX}
                    step={AVATAR_ZOOM_STEP}
                    value={editor.zoom}
                    onChange={(e) => updateTransform({ zoom: Number(e.target.value) })}
                    className="w-28 accent-white"
                    aria-label="Zoom"
                  />
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={editor.zoom >= AVATAR_ZOOM_MAX}
                    onClick={() =>
                      updateTransform({
                        zoom: Math.min(AVATAR_ZOOM_MAX, editor.zoom + AVATAR_ZOOM_STEP * 4),
                      })
                    }
                    className="text-white/90 hover:text-white disabled:opacity-40"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <div className="hidden sm:flex text-gray-300" aria-hidden>
                →
              </div>

              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Preview</p>
                {renderImageLayer(PREVIEW_SIZE, true)}
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-3">
              Drag to reposition. Use zoom to frame your avatar.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-5">
              <UserAvatar name={name} avatar={preview ?? currentAvatar} size={72} />
              <div>
                <p className="text-sm text-gray-600">Pick a preset or upload your own image.</p>
                <p className="text-xs text-gray-400 mt-1">JPG, PNG or GIF. Max 10MB.</p>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 mb-2">Choose avatar</div>
              <div className="grid grid-cols-6 gap-2">
                {AVATAR_PRESETS.map((preset) => (
                  <button
                    key={preset.seed}
                    type="button"
                    onClick={() => {
                      setError(null);
                      setPreview(preset.url);
                    }}
                    className={`rounded-full p-0.5 border-2 transition-colors ${
                      preview === preset.url
                        ? "border-[#2563EB]"
                        : "border-transparent hover:border-gray-200"
                    }`}
                    aria-label={`Use ${preset.seed} avatar`}
                  >
                    <UserAvatar name={preset.seed} avatar={preset.url} size={40} />
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processing}
                className="h-9 px-4 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-60"
              >
                {processing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {processing ? "Processing..." : "Upload image"}
              </button>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          {editor ? (
            <button
              type="button"
              onClick={() => {
                revokeEditorSrc();
                setEditor(null);
              }}
              className="h-9 px-4 text-sm text-gray-500 hover:text-gray-800"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="h-9 px-4 text-sm text-gray-500 hover:text-gray-800"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={processing}
            className="h-9 px-4 bg-[#2563EB] text-white rounded-lg text-sm font-semibold hover:bg-[#1D4ED8] flex items-center gap-2 disabled:opacity-60"
          >
            {processing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {editor ? "Upload" : "Use avatar"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
