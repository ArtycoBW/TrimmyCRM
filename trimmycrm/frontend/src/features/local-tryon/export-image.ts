const DISCLAIMER = "Примерная визуализация. Реальный результат может отличаться.";

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось подготовить изображение")), "image/png");
  });
}

export async function exportLocalResult(source: HTMLCanvasElement) {
  const footerHeight = Math.max(70, Math.round(source.width * 0.065));
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height + footerHeight;
  const context = output.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D недоступен в этом браузере");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0);
  context.fillStyle = "#000000";
  context.font = `700 ${Math.max(16, Math.round(source.width * 0.018))}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(DISCLAIMER, output.width / 2, source.height + footerHeight / 2, output.width - 40);

  const blob = await canvasToBlob(output);
  output.width = 1;
  output.height = 1;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "trimmycrm-tryon-result.png";
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
