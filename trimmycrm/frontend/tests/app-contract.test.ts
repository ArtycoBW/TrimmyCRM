import { describe, expect, it } from "vitest";

import type { SiteView } from "../src/lib/api/types";
import { appointmentStatuses, formatSalonTimezone, launchChecklist, salonDayKey } from "../src/lib/app/dashboard";
import {
  addDays,
  appointmentMatchesService,
  appointmentServiceLabel,
  calendarEventLanes,
  calendarPosition,
  startOfWeekKey,
  statusTransitions,
  weekQueryRange,
  zonedDateTimeToIso,
} from "../src/lib/app/calendar";
import {
  clientFormSchema,
  personInitials,
} from "../src/lib/app/crm";
import { onboardingSchema, slugifySalonName } from "../src/lib/app/onboarding";

const site = {
  id: "site-id",
  ownerId: "owner-id",
  name: "Форма",
  slug: "forma",
  salonType: "women_hair_salon",
  serviceFocuses: ["haircut", "color"],
  locale: "ru-RU",
  currency: "RUB",
  customDomain: null,
  domainVerified: false,
  description: null,
  city: null,
  street: null,
  phone: null,
  workHours: {},
  socials: {},
  logoUrl: null,
  theme: {},
  timezone: "Europe/Moscow",
  templateKey: "default",
  status: "draft",
  publishedAt: null,
  draftVersion: 0,
  publishedVersion: null,
  createdAt: "2026-07-16T10:00:00Z",
  updatedAt: "2026-07-16T10:00:00Z",
} satisfies SiteView;

describe("owner app contract", () => {
  it("creates a backend-compatible slug from a Russian salon name", () => {
    expect(slugifySalonName("Форма & Цвет")).toBe("forma-cvet");
    expect(slugifySalonName("  Барбер — клуб!  ")).toBe("barber-klub");
  });

  it("validates the payload required by POST /sites", () => {
    expect(onboardingSchema.safeParse({
      name: "Форма",
      salonType: "women_hair_salon",
      city: "Казань",
      slug: "forma",
      timezone: "Europe/Moscow",
    }).success).toBe(true);
    expect(onboardingSchema.safeParse({
      name: "Х",
      salonType: "pet_salon",
      city: "",
      slug: "форма",
      timezone: "Europe/Moscow",
    }).success).toBe(false);
  });

  it("uses the salon timezone when grouping appointments by day", () => {
    const instant = "2026-07-16T21:30:00Z";
    expect(salonDayKey(instant, "Europe/Moscow")).toBe("2026-07-17");
    expect(salonDayKey(instant, "Europe/Kaliningrad")).toBe("2026-07-16");
    expect(formatSalonTimezone("Europe/Moscow")).toBe("Москва (UTC+3)");
    expect(appointmentStatuses.cancelled.label).toBe("Отменена");
  });

  it("derives setup progress from persisted site and CRM data", () => {
    const initial = launchChecklist(site, 0, 0);
    expect(initial.filter((item) => item.complete)).toHaveLength(1);
    const ready = launchChecklist({
      ...site,
      workHours: { monday: [{ start: "09:00", end: "18:00" }] },
      publishedVersion: 2,
    }, 3, 1);
    expect(ready.every((item) => item.complete)).toBe(true);
  });

  it("builds backend calendar ranges in the salon timezone", () => {
    expect(startOfWeekKey("2026-07-16")).toBe("2026-07-13");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(zonedDateTimeToIso("2026-07-20", "10:30", "Europe/Moscow"))
      .toBe("2026-07-20T07:30:00.000Z");
    expect(weekQueryRange("2026-07-20", "Europe/Moscow")).toEqual({
      from: "2026-07-19T21:00:00.000Z",
      to: "2026-07-26T21:00:00.000Z",
    });
  });

  it("keeps status transitions and calendar placement aligned with the backend", () => {
    expect(statusTransitions.new).toEqual(["confirmed", "cancelled"]);
    expect(statusTransitions.completed).toEqual([]);
    expect(calendarPosition({
      startAt: "2026-07-20T07:00:00Z",
      endAt: "2026-07-20T08:30:00Z",
    }, "Europe/Moscow")).toEqual({
      topPercent: expect.closeTo(15.3846, 3),
      heightPercent: expect.closeTo(11.5384, 3),
    });
  });

  it("places overlapping visits into separate calendar lanes without hiding either visit", () => {
    const values = [
      { id: "first", startAt: "2026-07-20T07:00:00Z", endAt: "2026-07-20T08:30:00Z" },
      { id: "second", startAt: "2026-07-20T07:15:00Z", endAt: "2026-07-20T08:15:00Z" },
      { id: "third", startAt: "2026-07-20T08:20:00Z", endAt: "2026-07-20T09:00:00Z" },
    ];

    expect(calendarEventLanes(values, "Europe/Moscow")).toEqual([
      expect.objectContaining({ appointment: values[0], lane: 0, lanes: 2 }),
      expect.objectContaining({ appointment: values[1], lane: 1, lanes: 2 }),
      expect.objectContaining({ appointment: values[2], lane: 1, lanes: 2 }),
    ]);
  });

  it("uses all appointment item snapshots in labels and service filters", () => {
    const appointment = {
      serviceId: "haircut",
      serviceName: "Старая основная услуга",
      items: [
        { serviceId: "haircut", serviceName: "Стрижка" },
        { serviceId: "color", serviceName: "Тонирование" },
      ],
    };
    expect(appointmentServiceLabel(appointment)).toBe("Стрижка + Тонирование");
    expect(appointmentMatchesService(appointment, "color")).toBe(true);
    expect(appointmentMatchesService(appointment, "care")).toBe(false);
  });

  it("validates client forms without inventing required contacts", () => {
    expect(clientFormSchema.safeParse({
      fullName: "Анна Петрова",
      email: "",
      phone: "",
      consent: false,
      status: "crm_only",
    }).success).toBe(true);
    expect(clientFormSchema.safeParse({
      fullName: "Анна Петрова",
      email: "wrong-email",
      phone: "",
      consent: true,
      status: "active",
    }).success).toBe(false);
  });

  it("builds readable initials for client avatars", () => {
    expect(personInitials("Анна Петрова")).toBe("АП");
    expect(personInitials("  Ольга  ")).toBe("О");
    expect(personInitials(null)).toBe("К");
  });
});
