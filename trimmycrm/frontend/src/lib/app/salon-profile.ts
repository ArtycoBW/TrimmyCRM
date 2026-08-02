export const salonTypes = [
  "women_hair_salon",
  "barbershop",
  "unisex_hair_salon",
] as const;

export type SalonType = (typeof salonTypes)[number];

export const salonTypeOptions: ReadonlyArray<{
  value: SalonType;
  label: string;
  description: string;
}> = [
  {
    value: "women_hair_salon",
    label: "Женский салон",
    description: "Стрижки, окрашивание, укладки и уход",
  },
  {
    value: "barbershop",
    label: "Барбершоп",
    description: "Стрижки, бритьё, борода и камуфляж",
  },
  {
    value: "unisex_hair_salon",
    label: "Универсальный",
    description: "Объединённый каталог для всех клиентов",
  },
];

export function salonTypeLabel(value: SalonType): string {
  return salonTypeOptions.find((option) => option.value === value)?.label ?? "Салон";
}
