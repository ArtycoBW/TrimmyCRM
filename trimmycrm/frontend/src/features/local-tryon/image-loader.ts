export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 24_000_000;
export const MAX_WORKING_EDGE = 2048;
export const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type PhotoFileMetadata = Pick<File, "size" | "type">;

export type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

export function validatePhotoFile(file: PhotoFileMetadata) {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    throw new Error("Выберите JPG, PNG или WebP");
  }
  if (file.size <= 0) throw new Error("Файл пустой");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Фото больше 12 МБ");
}

export function workingSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Не удалось определить размер фото");
  }
  if (width * height > MAX_SOURCE_PIXELS) throw new Error("Фото содержит слишком много пикселей");
  const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decodeWithImageElement(file: File): Promise<DecodedPhoto> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    image.src = "";
    throw new Error("Браузер не смог прочитать это фото");
  }
  URL.revokeObjectURL(objectUrl);
  const size = workingSize(image.naturalWidth, image.naturalHeight);
  return {
    source: image,
    ...size,
    release: () => { image.src = ""; },
  };
}

export async function decodeLocalPhoto(file: File): Promise<DecodedPhoto> {
  validatePhotoFile(file);
  if (typeof createImageBitmap !== "function") return decodeWithImageElement(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Браузер не смог прочитать это фото");
  }
  try {
    const size = workingSize(bitmap.width, bitmap.height);
    return { source: bitmap, ...size, release: () => bitmap.close() };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

export function loadTemplateImage(asset: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      image.src = "";
      cleanup();
      reject(new DOMException("Загрузка отменена", "AbortError"));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("Не удалось открыть шаблон причёски")); };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = asset;
  });
}
