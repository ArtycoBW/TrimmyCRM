import { describe, expect, it } from "vitest";

import {
  compactSchedule,
  normalizeSchedule,
  serviceFormSchema,
  staffFormSchema,
  validateSchedule,
  weeklyMinutes,
} from "../src/lib/app/catalog";

describe("services and staff contracts", () => {
  it("validates the numeric constraints used by ServiceCreate", () => {
    const service = {
      name: "Комплексный уход",
      category: "Груминг",
      description: "",
      price: "2400.50",
      durationMin: "90",
      bufferBeforeMin: "0",
      bufferAfterMin: "15",
      isActive: true,
    };
    expect(serviceFormSchema.safeParse(service).success).toBe(true);
    expect(serviceFormSchema.safeParse({ ...service, durationMin: "92" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ ...service, price: "-1" }).success).toBe(false);
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
