export type AvatarCropTransform = {
  /** 1 = cover the square; higher = zoomed in */
  zoom: number;
  /** Pan offset in viewport pixels (positive = image moves right/down) */
  offsetX: number;
  offsetY: number;
};

export const AVATAR_ZOOM_MIN = 1;
export const AVATAR_ZOOM_MAX = 3;
export const AVATAR_ZOOM_STEP = 0.05;

/** Resize and compress an image file for avatar storage in MongoDB */
export async function compressAvatarFile(
  file: File,
  maxSize = 400,
  quality = 0.82,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const { width, height } = fitWithin(img.width, img.height, maxSize);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image");

    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length > 900_000) {
      throw new Error("Image is still too large after compression. Try a smaller photo.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Crop a square from the image using the same cover + zoom + pan math
 * as the on-screen editor viewport, then compress for storage.
 */
export async function cropAvatarFromImage(
  imageSrc: string,
  transform: AvatarCropTransform,
  options?: {
    viewportSize?: number;
    outputSize?: number;
    quality?: number;
  },
): Promise<string> {
  const viewportSize = options?.viewportSize ?? 280;
  const outputSize = options?.outputSize ?? 400;
  const quality = options?.quality ?? 0.82;
  const zoom = Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, transform.zoom));

  const img = await loadImage(imageSrc);
  const { width: iw, height: ih } = img;
  if (iw < 1 || ih < 1) throw new Error("Could not process image");

  const coverScale = viewportSize / Math.min(iw, ih);
  const displayScale = coverScale * zoom;
  const cropSizeNatural = viewportSize / displayScale;

  const centerX = iw / 2 - transform.offsetX / displayScale;
  const centerY = ih / 2 - transform.offsetY / displayScale;

  let sx = centerX - cropSizeNatural / 2;
  let sy = centerY - cropSizeNatural / 2;
  sx = clamp(sx, 0, Math.max(0, iw - cropSizeNatural));
  sy = clamp(sy, 0, Math.max(0, ih - cropSizeNatural));

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");

  ctx.drawImage(
    img,
    sx,
    sy,
    cropSizeNatural,
    cropSizeNatural,
    0,
    0,
    outputSize,
    outputSize,
  );

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (dataUrl.length > 900_000) {
    throw new Error("Image is still too large after compression. Try a smaller photo.");
  }
  return dataUrl;
}

/** Display size of the image inside a square cover viewport at the given zoom. */
export function getAvatarEditorImageSize(
  naturalWidth: number,
  naturalHeight: number,
  viewportSize: number,
  zoom: number,
) {
  const coverScale = viewportSize / Math.min(naturalWidth, naturalHeight);
  const displayScale = coverScale * zoom;
  return {
    width: naturalWidth * displayScale,
    height: naturalHeight * displayScale,
    displayScale,
  };
}

export function clampAvatarPan(
  offsetX: number,
  offsetY: number,
  imageWidth: number,
  imageHeight: number,
  viewportSize: number,
) {
  const maxX = Math.max(0, (imageWidth - viewportSize) / 2);
  const maxY = Math.max(0, (imageHeight - viewportSize) / 2);
  return {
    offsetX: clamp(offsetX, -maxX, maxX),
    offsetY: clamp(offsetY, -maxY, maxY),
  };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function fitWithin(width: number, height: number, max: number) {
  if (width <= max && height <= max) return { width, height };
  const scale = max / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
