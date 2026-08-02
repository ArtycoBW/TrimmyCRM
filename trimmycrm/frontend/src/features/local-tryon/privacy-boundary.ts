const templateIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const LOCAL_TRYON_DISCLAIMER = "Примерная визуализация. Реальный результат может отличаться.";
export const LOCAL_TRYON_PRIVACY_NOTICE = "Фото обрабатывается только на вашем устройстве. TrimmyCRM и салон не получают и не хранят это фото.";

export function consultationHref(templateId: string) {
  if (!templateIdPattern.test(templateId)) throw new Error("Некорректный ID шаблона");
  const query = new URLSearchParams({ booking: "1", hairstyleTemplateId: templateId });
  return `/client?${query.toString()}`;
}
