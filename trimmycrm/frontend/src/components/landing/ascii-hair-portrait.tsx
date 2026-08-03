"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./ascii-hair-portrait.module.css";

export const ASCII_RENDER_MODES = [
  "characters", "dither", "mosaic", "pixel", "dots", "cross", "diamond", "voxel", "lego", "mixed",
  "lines", "diagonal", "braille", "disco", "hexdump", "matrix", "rings", "hearts", "stars", "hexagons",
  "triangles", "bubbles", "hatch", "contour", "halfblocks",
] as const;

type RenderMode = (typeof ASCII_RENDER_MODES)[number];
type PostEffect = "scanLines" | "vignette" | "bloom" | "chromatic" | "filmGrain" | "glitch" | "halftone" | "pixelate" | "filmDust";
type EffectSetting = { enabled: boolean; intensity: number };

type AsciiParams = {
  pfx: Record<PostEffect, EffectSetting>;
  mask: { tool: string; invert: boolean; shapes: unknown[]; dataUrl: string | null; enabled: boolean; brushSize: number; showOverlay: boolean };
  tint: string;
  bgBlur: number;
  bgMode: "blur" | "solid" | "photo" | "none";
  invert: boolean;
  lights: { points: Array<{ x: number; y: number; radius: number; intensity: number }>; enabled: boolean };
  charSet: "standard" | "blocks" | "minimal";
  density: number;
  animated: boolean;
  blurType: "off" | "gaussian" | "motion";
  cellSize: number;
  contrast: number;
  coverage: number;
  animSpeed: EffectSetting;
  animStyle: "wave" | "pulse" | "shimmer" | "ripple" | "flicker";
  bgOpacity: number;
  blurAngle: number;
  grayscale: number;
  blurAmount: number;
  brightness: number;
  renderMode: RenderMode;
  saturation: number;
  styleBlend: GlobalCompositeOperation;
  customChars: string;
  tintOpacity: number;
  edgeEmphasis: number;
  overlayBlend: GlobalCompositeOperation;
  animIntensity: EffectSetting;
};

const defaultParams: AsciiParams = {
  pfx: {
    bloom: { enabled: true, intensity: 60 },
    glitch: { enabled: false, intensity: 20 },
    filmDust: { enabled: false, intensity: 20 },
    halftone: { enabled: false, intensity: 20 },
    pixelate: { enabled: true, intensity: 15 },
    vignette: { enabled: true, intensity: 38 },
    chromatic: { enabled: false, intensity: 15 },
    filmGrain: { enabled: false, intensity: 30 },
    scanLines: { enabled: true, intensity: 60 },
  },
  mask: { tool: "freehand", invert: false, shapes: [], dataUrl: null, enabled: false, brushSize: 30, showOverlay: false },
  tint: "#3ca6ff",
  bgBlur: 2,
  bgMode: "blur",
  invert: false,
  lights: { points: [], enabled: false },
  charSet: "standard",
  density: 0,
  animated: true,
  blurType: "off",
  cellSize: 13,
  contrast: 115,
  coverage: 100,
  animSpeed: { enabled: true, intensity: 100 },
  animStyle: "wave",
  bgOpacity: 90,
  blurAngle: 0,
  grayscale: 0,
  blurAmount: 35,
  brightness: 0,
  renderMode: "hatch",
  saturation: 100,
  styleBlend: "source-over",
  customChars: "",
  tintOpacity: 32,
  edgeEmphasis: 0,
  overlayBlend: "saturation",
  animIntensity: { enabled: true, intensity: 60 },
};

const modeChoices: Array<{ value: RenderMode; label: string }> = [
  { value: "hatch", label: "Штрих" },
  { value: "characters", label: "Знаки" },
  { value: "dots", label: "Точки" },
  { value: "contour", label: "Контур" },
];

type Buffers = {
  source: HTMLCanvasElement;
  effect: HTMLCanvasElement;
  composition: HTMLCanvasElement;
  temp: HTMLCanvasElement;
  pixels: HTMLCanvasElement;
  mask: HTMLCanvasElement;
};

function makeBuffers(): Buffers {
  return {
    source: document.createElement("canvas"),
    effect: document.createElement("canvas"),
    composition: document.createElement("canvas"),
    temp: document.createElement("canvas"),
    pixels: document.createElement("canvas"),
    mask: document.createElement("canvas"),
  };
}

function resizeBuffers(buffers: Buffers, width: number, height: number) {
  for (const canvas of Object.values(buffers)) {
    if (canvas === buffers.pixels) continue;
    canvas.width = width;
    canvas.height = height;
  }
}

function context(canvas: HTMLCanvasElement, read = false) {
  return canvas.getContext("2d", read ? { willReadFrequently: true } : undefined);
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function sampleCell(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, size: number) {
  const xEnd = Math.min(width, x + size);
  const yEnd = Math.min(height, y + size);
  const stride = Math.max(1, Math.floor(size / 4));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let py = y; py < yEnd; py += stride) {
    for (let px = x; px < xEnd; px += stride) {
      const index = (py * width + px) * 4;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }
  }
  if (!count) return { red: 0, green: 0, blue: 0, luminance: 0 };
  red /= count;
  green /= count;
  blue /= count;
  return { red, green, blue, luminance: (.2126 * red + .7152 * green + .0722 * blue) / 255 };
}

function hashCell(column: number, row: number) {
  const value = Math.sin(column * 12.9898 + row * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function polygon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, sides: number, rotation = 0) {
  ctx.beginPath();
  for (let side = 0; side < sides; side += 1) {
    const angle = rotation + side * Math.PI * 2 / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (!side) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + half * .8);
  ctx.bezierCurveTo(x - size, y + half * .15, x - half, y - half, x, y - half * .15);
  ctx.bezierCurveTo(x + half, y - half, x + size, y + half * .15, x, y + half * .8);
  ctx.closePath();
}

function drawPrimitive(
  ctx: CanvasRenderingContext2D,
  mode: RenderMode,
  x: number,
  y: number,
  size: number,
  luminance: number,
  color: string,
  column: number,
  row: number,
  time: number,
  charSet: string,
) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const darkness = 1 - luminance;
  const radius = Math.max(1, size * (.12 + darkness * .4));
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * .055);

  switch (mode) {
    case "characters": {
      const index = Math.min(charSet.length - 1, Math.floor(darkness * charSet.length));
      ctx.font = `700 ${Math.max(6, size * (.5 + darkness * .42))}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(charSet[index] || "#", centerX, centerY);
      break;
    }
    case "dither": {
      const matrix = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
      if (darkness * 16 > matrix[row % 4][column % 4]) ctx.fillRect(x, y, size + .5, size + .5);
      break;
    }
    case "mosaic":
      ctx.save(); ctx.translate(centerX, centerY); ctx.rotate((hashCell(column, row) - .5) * .3); ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
      break;
    case "pixel": ctx.fillRect(x, y, size * Math.max(.12, darkness), size * Math.max(.12, darkness)); break;
    case "dots": ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2); ctx.fill(); break;
    case "cross":
      ctx.beginPath(); ctx.moveTo(centerX - radius, centerY); ctx.lineTo(centerX + radius, centerY); ctx.moveTo(centerX, centerY - radius); ctx.lineTo(centerX, centerY + radius); ctx.stroke();
      break;
    case "diamond": polygon(ctx, centerX, centerY, radius, 4, Math.PI / 4); ctx.fill(); break;
    case "voxel":
      polygon(ctx, centerX, centerY - radius * .35, radius, 4, Math.PI / 4); ctx.fill();
      ctx.globalAlpha *= .55; ctx.fillRect(centerX - radius, centerY - radius * .35, radius, radius); ctx.globalAlpha /= .55;
      break;
    case "lego":
      ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
      ctx.globalAlpha *= .55; ctx.beginPath(); ctx.arc(centerX, centerY - radius * .45, radius * .34, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha /= .55;
      break;
    case "mixed": {
      const mixed: RenderMode[] = ["dots", "diamond", "characters", "lines"];
      drawPrimitive(ctx, mixed[Math.floor(hashCell(column, row) * mixed.length)], x, y, size, luminance, color, column, row, time, charSet);
      break;
    }
    case "lines":
      ctx.beginPath(); ctx.moveTo(centerX - radius, centerY); ctx.lineTo(centerX + radius, centerY); ctx.stroke();
      break;
    case "diagonal":
      ctx.beginPath(); ctx.moveTo(centerX - radius, centerY + radius); ctx.lineTo(centerX + radius, centerY - radius); ctx.stroke();
      break;
    case "braille": {
      const braille = "⠀⠁⠃⠇⠏⠟⠿⣿";
      ctx.font = `${size * .82}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(braille[Math.min(braille.length - 1, Math.floor(darkness * braille.length))], centerX, centerY);
      break;
    }
    case "disco":
      ctx.fillStyle = `hsl(${(column * 19 + row * 11 + time * .04) % 360} 82% 54%)`; ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2); ctx.fill();
      break;
    case "hexdump":
      ctx.font = `700 ${size * .72}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(Math.floor(darkness * 15).toString(16).toUpperCase(), centerX, centerY);
      break;
    case "matrix":
      ctx.fillStyle = `rgb(70 ${150 + Math.floor(darkness * 105)} 110)`; ctx.font = `700 ${size * .78}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String.fromCharCode(0x30a0 + ((column * 7 + row * 13 + Math.floor(time / 80)) % 80)), centerX, centerY);
      break;
    case "rings": ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2); ctx.stroke(); break;
    case "hearts": drawHeart(ctx, centerX, centerY, radius); ctx.fill(); break;
    case "stars": polygon(ctx, centerX, centerY, radius, 5, -Math.PI / 2); ctx.fill(); break;
    case "hexagons": polygon(ctx, centerX, centerY, radius, 6); ctx.stroke(); break;
    case "triangles": polygon(ctx, centerX, centerY, radius, 3, (column + row) % 2 ? Math.PI / 2 : -Math.PI / 2); ctx.fill(); break;
    case "bubbles":
      ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha *= .55; ctx.beginPath(); ctx.arc(centerX - radius * .3, centerY - radius * .3, Math.max(1, radius * .16), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha /= .55;
      break;
    case "hatch": {
      const lineCount = 1 + Math.floor(darkness * 4);
      for (let line = 0; line < lineCount; line += 1) {
        const offset = (line - (lineCount - 1) / 2) * size * .15;
        ctx.beginPath(); ctx.moveTo(x + size * .1, y + size * .85 + offset); ctx.lineTo(x + size * .85, y + size * .1 + offset); ctx.stroke();
      }
      if (darkness > .52) {
        ctx.globalAlpha *= .55; ctx.beginPath(); ctx.moveTo(x + size * .1, y + size * .15); ctx.lineTo(x + size * .85, y + size * .9); ctx.stroke(); ctx.globalAlpha /= .55;
      }
      break;
    }
    case "contour":
      ctx.beginPath(); ctx.arc(centerX, centerY, radius, Math.PI * .1, Math.PI * 1.75); ctx.stroke();
      if (darkness > .55) { ctx.beginPath(); ctx.arc(centerX, centerY, radius * .55, 0, Math.PI * 1.55); ctx.stroke(); }
      break;
    case "halfblocks":
      ctx.fillRect(x, y, size, size / 2 * Math.max(.1, darkness));
      ctx.globalAlpha *= .55; ctx.fillRect(x, y + size / 2, size, size / 2 * Math.max(.1, 1 - Math.abs(.5 - luminance))); ctx.globalAlpha /= .55;
      break;
  }
}

function animationValue(params: AsciiParams, column: number, row: number, time: number, columns: number, rows: number) {
  if (!params.animated || !params.animIntensity.enabled) return { scale: 1, alpha: 1 };
  const speed = params.animSpeed.enabled ? params.animSpeed.intensity / 100 : 0;
  const phase = time * .0022 * speed;
  let value = 0;
  if (params.animStyle === "pulse") value = Math.sin(phase * 2);
  if (params.animStyle === "wave") value = Math.sin(column * .34 + row * .09 + phase * 2.2);
  if (params.animStyle === "shimmer") value = Math.sin((column + row) * .28 - phase * 3);
  if (params.animStyle === "ripple") value = Math.sin(Math.hypot(column - columns / 2, row - rows / 2) * .45 - phase * 3);
  if (params.animStyle === "flicker") value = hashCell(column + Math.floor(time / 90), row) * 2 - 1;
  const intensity = params.animIntensity.intensity / 100;
  return { scale: 1 + value * .13 * intensity, alpha: .84 + (value + 1) * .08 * intensity };
}

function applyPostEffects(
  ctx: CanvasRenderingContext2D,
  buffers: Buffers,
  width: number,
  height: number,
  time: number,
  params: AsciiParams,
  ratio: number,
) {
  const tempCtx = context(buffers.temp);
  if (!tempCtx) return;
  tempCtx.clearRect(0, 0, width, height);
  tempCtx.drawImage(ctx.canvas, 0, 0);

  if (params.pfx.pixelate.enabled) {
    const amount = Math.max(2, Math.round(params.pfx.pixelate.intensity / 5));
    buffers.pixels.width = Math.max(1, Math.floor(width / amount));
    buffers.pixels.height = Math.max(1, Math.floor(height / amount));
    const pixelCtx = context(buffers.pixels);
    if (pixelCtx) {
      pixelCtx.imageSmoothingEnabled = false;
      pixelCtx.drawImage(buffers.temp, 0, 0, buffers.pixels.width, buffers.pixels.height);
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffers.pixels, 0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      tempCtx.clearRect(0, 0, width, height);
      tempCtx.drawImage(ctx.canvas, 0, 0);
    }
  }

  if (params.pfx.bloom.enabled) {
    ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = params.pfx.bloom.intensity / 240;
    ctx.filter = `blur(${Math.max(2, params.pfx.bloom.intensity * .08 * ratio)}px)`; ctx.drawImage(buffers.temp, 0, 0); ctx.restore();
  }
  if (params.pfx.chromatic.enabled) {
    const shift = params.pfx.chromatic.intensity * .08 * ratio;
    ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = .14; ctx.drawImage(buffers.temp, shift, 0); ctx.drawImage(buffers.temp, -shift, 0); ctx.restore();
  }
  if (params.pfx.glitch.enabled) {
    const slices = Math.ceil(params.pfx.glitch.intensity / 5);
    ctx.save();
    for (let slice = 0; slice < slices; slice += 1) {
      const y = hashCell(slice, Math.floor(time / 120)) * height;
      const sliceHeight = Math.max(2, ratio * 5);
      const shift = (hashCell(slice + 7, Math.floor(time / 100)) - .5) * params.pfx.glitch.intensity * ratio;
      ctx.drawImage(buffers.temp, 0, y, width, sliceHeight, shift, y, width, sliceHeight);
    }
    ctx.restore();
  }
  if (params.pfx.scanLines.enabled) {
    ctx.save(); ctx.globalAlpha = params.pfx.scanLines.intensity / 520; ctx.fillStyle = "#000";
    const spacing = Math.max(3, Math.round(4 * ratio));
    for (let y = 0; y < height; y += spacing) ctx.fillRect(0, y, width, Math.max(1, ratio));
    ctx.restore();
  }
  if (params.pfx.halftone.enabled) {
    ctx.save(); ctx.globalAlpha = params.pfx.halftone.intensity / 500; ctx.fillStyle = "#000";
    const spacing = Math.max(5, 8 * ratio);
    for (let y = 0; y < height; y += spacing) for (let x = 0; x < width; x += spacing) { ctx.beginPath(); ctx.arc(x, y, ratio, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  if (params.pfx.filmGrain.enabled) {
    ctx.save(); ctx.globalAlpha = params.pfx.filmGrain.intensity / 700; ctx.fillStyle = "#fff";
    const grains = Math.floor(width * height / 9000);
    for (let grain = 0; grain < grains; grain += 1) {
      const x = hashCell(grain, Math.floor(time / 70)) * width;
      const y = hashCell(grain + 23, Math.floor(time / 70)) * height;
      ctx.fillRect(x, y, ratio, ratio);
    }
    ctx.restore();
  }
  if (params.pfx.filmDust.enabled) {
    ctx.save(); ctx.globalAlpha = params.pfx.filmDust.intensity / 300; ctx.strokeStyle = "#fff"; ctx.lineWidth = ratio;
    for (let dust = 0; dust < 5; dust += 1) {
      const x = hashCell(dust, Math.floor(time / 600)) * width;
      const y = hashCell(dust + 5, Math.floor(time / 600)) * height;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ratio * 3, y + ratio * 18); ctx.stroke();
    }
    ctx.restore();
  }
  if (params.pfx.vignette.enabled) {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .2, width / 2, height / 2, Math.max(width, height) * .7);
    gradient.addColorStop(0, "rgb(0 0 0 / 0)");
    gradient.addColorStop(1, `rgb(0 0 0 / ${params.pfx.vignette.intensity / 125})`);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }
}

function drawAnimatedRaster(
  ctx: CanvasRenderingContext2D,
  raster: HTMLCanvasElement,
  width: number,
  height: number,
  time: number,
  params: AsciiParams,
  ratio: number,
) {
  if (!params.animated || !params.animIntensity.enabled) {
    ctx.drawImage(raster, 0, 0);
    return;
  }
  const speed = params.animSpeed.enabled ? params.animSpeed.intensity / 100 : 0;
  const phase = time * .0022 * speed;
  const intensity = params.animIntensity.intensity / 100;
  if (params.animStyle === "pulse") {
    const scale = 1 + Math.sin(phase * 2) * .012 * intensity;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);
    ctx.drawImage(raster, 0, 0);
    return;
  }
  if (params.animStyle === "shimmer" || params.animStyle === "flicker") {
    const wave = params.animStyle === "shimmer" ? Math.sin(phase * 3) : hashCell(Math.floor(time / 100), 7) * 2 - 1;
    ctx.globalAlpha = .9 + wave * .08 * intensity;
    ctx.drawImage(raster, 0, 0);
    return;
  }

  const bandHeight = Math.max(5, Math.round(9 * ratio));
  const amplitude = Math.max(1, 3.2 * ratio * intensity);
  for (let y = 0; y < height; y += bandHeight) {
    const distance = Math.abs(y - height / 2) / Math.max(1, height / 2);
    const wave = params.animStyle === "ripple"
      ? Math.sin(distance * 18 - phase * 3)
      : Math.sin(y * .025 / Math.max(.7, ratio) + phase * 2.2);
    ctx.drawImage(raster, 0, y, width, bandHeight, wave * amplitude, y, width, bandHeight);
  }
}

function renderFrame(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  maskImage: HTMLImageElement | null,
  buffers: Buffers,
  params: AsciiParams,
  time: number,
  ratio: number,
  rasterDirty = false,
) {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return;
  const output = context(canvas);
  const source = context(buffers.source, true);
  const effect = context(buffers.effect);
  const composition = context(buffers.composition);
  const temp = context(buffers.temp);
  if (!output || !source || !effect || !composition || !temp) return;

  if (rasterDirty) {
    source.clearRect(0, 0, width, height);
    drawCover(source, image, width, height);
    const pixels = source.getImageData(0, 0, width, height).data;

    effect.clearRect(0, 0, width, height);
    const baseCell = Math.max(5, params.cellSize * ratio);
    const cell = Math.max(4, Math.round(baseCell * (1 - Math.min(90, params.density) / 200)));
    const columns = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const charset = params.customChars || (params.charSet === "blocks" ? " ░▒▓█" : params.charSet === "minimal" ? " .:+#" : " .,:;irsXA253hMHGS#9B&@");

    for (let y = 0, row = 0; y < height; y += cell, row += 1) {
      for (let x = 0, column = 0; x < width; x += cell, column += 1) {
        if (hashCell(column, row) * 100 > params.coverage) continue;
        const sample = sampleCell(pixels, width, height, x, y, cell);
        let luminance = params.invert ? 1 - sample.luminance : sample.luminance;
        if (params.edgeEmphasis > 0) {
          const neighbor = sampleCell(pixels, width, height, Math.min(width - 1, x + cell), y, cell);
          luminance = Math.max(0, Math.min(1, luminance - Math.abs(sample.luminance - neighbor.luminance) * params.edgeEmphasis / 100));
        }
        const animation = animationValue(params, column, row, 0, columns, rows);
        const color = `rgb(${Math.round(sample.red)} ${Math.round(sample.green)} ${Math.round(sample.blue)})`;
        effect.save();
        effect.globalAlpha = animation.alpha;
        effect.translate(x + cell / 2, y + cell / 2);
        effect.scale(animation.scale, animation.scale);
        effect.translate(-(x + cell / 2), -(y + cell / 2));
        drawPrimitive(effect, params.renderMode, x, y, cell, luminance, color, column, row, 0, charset);
        effect.restore();
      }
    }
  }

  composition.clearRect(0, 0, width, height);
  composition.save();
  composition.globalAlpha = params.bgOpacity / 100;
  if (params.bgMode === "solid") {
    composition.fillStyle = "#000";
    composition.fillRect(0, 0, width, height);
  } else if (params.bgMode === "photo") {
    composition.drawImage(buffers.source, 0, 0);
  } else if (params.bgMode === "blur") {
    composition.filter = `blur(${params.bgBlur * ratio}px)`;
    composition.drawImage(buffers.source, -params.bgBlur * ratio, -params.bgBlur * ratio, width + params.bgBlur * ratio * 2, height + params.bgBlur * ratio * 2);
  }
  composition.restore();

  composition.save();
  composition.globalCompositeOperation = params.styleBlend;
  drawAnimatedRaster(composition, buffers.effect, width, height, time, params, ratio);
  composition.restore();

  output.clearRect(0, 0, width, height);
  output.save();
  output.filter = `brightness(${100 + params.brightness}%) contrast(${params.contrast}%) saturate(${params.saturation}%) grayscale(${params.grayscale}%)`;
  output.drawImage(buffers.composition, 0, 0);
  output.restore();
  output.save();
  output.globalCompositeOperation = params.overlayBlend;
  output.globalAlpha = params.tintOpacity / 100;
  output.fillStyle = params.tint;
  output.fillRect(0, 0, width, height);
  output.restore();

  if (params.blurType !== "off" && params.blurAmount > 0) {
    temp.clearRect(0, 0, width, height);
    temp.drawImage(canvas, 0, 0);
    output.clearRect(0, 0, width, height);
    output.save();
    if (params.blurType === "gaussian") output.filter = `blur(${params.blurAmount * .12 * ratio}px)`;
    if (params.blurType === "motion") {
      const angle = params.blurAngle * Math.PI / 180;
      output.translate(Math.cos(angle) * params.blurAmount * .04 * ratio, Math.sin(angle) * params.blurAmount * .04 * ratio);
      output.globalAlpha = .86;
    }
    output.drawImage(buffers.temp, 0, 0);
    output.restore();
  }

  applyPostEffects(output, buffers, width, height, time, params, ratio);

  if (params.lights.enabled) {
    for (const point of params.lights.points) {
      const x = point.x * width;
      const y = point.y * height;
      const radius = point.radius * Math.min(width, height);
      const light = output.createRadialGradient(x, y, 0, x, y, radius);
      light.addColorStop(0, `rgb(255 255 255 / ${point.intensity})`);
      light.addColorStop(1, "rgb(255 255 255 / 0)");
      output.save(); output.globalCompositeOperation = "screen"; output.fillStyle = light; output.fillRect(0, 0, width, height); output.restore();
    }
  }

  if (params.mask.enabled && maskImage) {
    const maskCtx = context(buffers.mask);
    if (maskCtx) {
      maskCtx.clearRect(0, 0, width, height);
      maskCtx.drawImage(buffers.source, 0, 0);
      maskCtx.globalCompositeOperation = params.mask.invert ? "destination-out" : "destination-in";
      maskCtx.drawImage(maskImage, 0, 0, width, height);
      maskCtx.globalCompositeOperation = "source-over";
      output.drawImage(buffers.mask, 0, 0);
    }
  }
}

export function AsciiHairPortrait({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RenderMode>("hatch");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const params = useMemo(() => ({ ...defaultParams, renderMode: mode }), [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const buffers = makeBuffers();
    const image = new Image();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let maskImage: HTMLImageElement | null = null;
    let animationFrame = 0;
    let lastPaint = 0;
    let disposed = false;
    let ready = false;

    const resize = () => {
      const bounds = frame.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.65);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        resizeBuffers(buffers, width, height);
      }
      if (ready) renderFrame(canvas, image, maskImage, buffers, params, performance.now(), ratio, true);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(frame);

    const animate = (time: number) => {
      if (disposed || !ready) return;
      if (time - lastPaint >= 1000 / 24) {
        const ratio = Math.min(window.devicePixelRatio || 1, 1.65);
        renderFrame(canvas, image, maskImage, buffers, params, time, ratio);
        lastPaint = time;
      }
      if (params.animated && !reducedMotion.matches) animationFrame = requestAnimationFrame(animate);
    };

    image.decoding = "async";
    image.onload = () => {
      if (disposed) return;
      ready = true;
      setStatus("ready");
      resize();
      if (params.animated && !reducedMotion.matches) animationFrame = requestAnimationFrame(animate);
    };
    image.onerror = () => { if (!disposed) setStatus("error"); };
    image.src = src;

    if (params.mask.enabled && params.mask.dataUrl) {
      maskImage = new Image();
      maskImage.src = params.mask.dataUrl;
    }

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
      image.onload = null;
      image.onerror = null;
    };
  }, [params, src]);

  return (
    <div className={styles.shell}>
      <div ref={frameRef} className={styles.frame} data-status={status}>
        <canvas ref={canvasRef} role="img" aria-label={alt} />
        {status === "loading" && <span className={styles.status}>Готовим эффект</span>}
        {status === "error" && <span className={styles.status}>Не удалось открыть изображение</span>}
      </div>
      <div className={styles.controls} aria-label="Режим изображения">
        {modeChoices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={mode === choice.value}
            onClick={() => setMode(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <p>Canvas2D пересобирает локальное фото в реальном времени.</p>
    </div>
  );
}
