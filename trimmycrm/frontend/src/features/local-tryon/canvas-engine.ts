import type { HairstyleTemplate, TryOnTransform } from "./template-types";

export const MIN_TEMPLATE_WIDTH = 0.12;
export const MAX_TEMPLATE_WIDTH = 1.5;

export function initialTransform(template: HairstyleTemplate): TryOnTransform {
  return {
    x: template.anchor.x,
    y: template.anchor.y,
    width: template.anchor.width,
    rotation: 0,
    mirrored: false,
    opacity: 1,
  };
}

export function clampTransform(transform: TryOnTransform): TryOnTransform {
  return {
    x: Math.min(1.5, Math.max(-0.5, transform.x)),
    y: Math.min(1.5, Math.max(-0.5, transform.y)),
    width: Math.min(MAX_TEMPLATE_WIDTH, Math.max(MIN_TEMPLATE_WIDTH, transform.width)),
    rotation: Math.min(180, Math.max(-180, transform.rotation)),
    mirrored: transform.mirrored,
    opacity: Math.min(1, Math.max(0.25, transform.opacity)),
  };
}

export function moveTransform(transform: TryOnTransform, deltaX: number, deltaY: number): TryOnTransform {
  return clampTransform({ ...transform, x: transform.x + deltaX, y: transform.y + deltaY });
}

export function drawComposition(
  canvas: HTMLCanvasElement,
  photo: CanvasImageSource,
  photoWidth: number,
  photoHeight: number,
  templateImage: CanvasImageSource & { width: number; height: number },
  transform: TryOnTransform,
) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D недоступен в этом браузере");
  if (canvas.width !== photoWidth) canvas.width = photoWidth;
  if (canvas.height !== photoHeight) canvas.height = photoHeight;

  context.save();
  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(photo, 0, 0, photoWidth, photoHeight);
  context.restore();

  const width = canvas.width * transform.width;
  const height = width * (templateImage.height / templateImage.width);
  context.save();
  context.globalAlpha = transform.opacity;
  context.translate(canvas.width * transform.x, canvas.height * transform.y);
  context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.mirrored ? -1 : 1, 1);
  context.drawImage(templateImage, -width / 2, -height / 2, width, height);
  context.restore();
}
