import { describe, expect, it } from "vitest";

import {
  buildCatalogOptionPayload,
  buildServicePayload,
  catalogOptionSchema,
  compactSchedule,
  formatServicePrice,
  normalizeSchedule,
  serviceFormSchema,
  staffFormSchema,
  validateSchedule,
  weeklyMinutes,
} from "../src/lib/app/catalog";

describe("services and staff contracts", () => {
  it("validates the numeric constraints used by ServiceCreate", () => {
    const service = {
      name: "Стрижка и укладка",
      categoryId: "category-id",
      description: "",
      priceType: "range" as const,
      price: "2400.50",
      maxPrice: "3200",
      durationMin: "90",
      bufferBeforeMin: "0",
      bufferAfterMin: "15",
      requiresConsultation: false,
      requiresPatchTest: false,
      allowOnlineBooking: true,
      variantSelectionRequired: true,
      preparationText: "",
      aftercareText: "",
      isActive: true,
    };
    expect(serviceFormSchema.safeParse(service).success).toBe(true);
    expect(serviceFormSchema.safeParse({ ...service, durationMin: "92" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ ...service, price: "-1" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ ...service, maxPrice: "2000" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ ...service, maxPrice: "" }).success).toBe(false);
  });

  it("builds the normalized hair-service payload", () => {
    const parsed = serviceFormSchema.parse({
      name: "Сложное окрашивание",
      categoryId: "uncategorized",
      description: "Консультация и окрашивание",
      priceType: "from",
      price: "7500,50",
      maxPrice: "",
      durationMin: "240",
      bufferBeforeMin: "0",
      bufferAfterMin: "20",
      requiresConsultation: true,
      requiresPatchTest: true,
      allowOnlineBooking: false,
      variantSelectionRequired: false,
      preparationText: "Не использовать тонирующие средства",
      aftercareText: "Домашний уход согласовать с мастером",
      isActive: true,
    });

    expect(buildServicePayload(parsed)).toMatchObject({
      categoryId: null,
      price: 7500.5,
      maxPrice: null,
      priceType: "from",
      currency: "RUB",
      requiresConsultation: true,
      requiresPatchTest: true,
      allowOnlineBooking: false,
    });
    expect(formatServicePrice({ price: "7500.50", maxPrice: null, priceType: "from" }))
      .toBe("от 7 501 ₽");
  });

  it("validates variant and add-on modifiers", () => {
    const option = catalogOptionSchema.parse({
      label: "Ниже плеч",
      priceDelta: "1500",
      durationDeltaMin: "30",
    });
    expect(buildCatalogOptionPayload(option)).toEqual({
      priceDelta: 1500,
      durationDeltaMin: 30,
    });
    expect(catalogOptionSchema.safeParse({ ...option, durationDeltaMin: "7" }).success).toBe(false);
  });

  it("keeps staff email optional but validates invitations", () => {
    expect(staffFormSchema.safeParse({
      name: "Мария Волкова",
      email: "",
      specialization: "",
      isActive: true,
    }).success).toBe(true);
    expect(staffFormSchema.safeParse({
      name: "Мария Волкова",
      email: "wrong",
      specialization: "",
      isActive: true,
    }).success).toBe(false);
  });

  it("normalizes and compacts weekly schedules for the backend", () => {
    const schedule = normalizeSchedule({
      monday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
      tuesday: [],
    });
    expect(validateSchedule(schedule)).toBeNull();
    expect(weeklyMinutes(schedule)).toBe(480);
    expect(compactSchedule(schedule)).toEqual({
      monday: [{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }],
    });
  });

  it("rejects overlapping and reversed staff shifts", () => {
    const overlap = normalizeSchedule({
      monday: [{ start: "09:00", end: "14:00" }, { start: "13:00", end: "18:00" }],
    });
    expect(validateSchedule(overlap)).toContain("не должны пересекаться");
    const reversed = normalizeSchedule({
      monday: [{ start: "18:00", end: "09:00" }],
    });
    expect(validateSchedule(reversed)).toContain("позже начала");
  });
});
