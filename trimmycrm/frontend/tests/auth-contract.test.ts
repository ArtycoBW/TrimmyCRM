import { describe, expect, it } from "vitest";

import { platformRegisterSchema, registerSchema } from "../src/components/auth/auth-schemas";
import { passwordChecks } from "../src/components/auth/auth-utils";
import { realmForHostname, safeNextPath } from "../src/lib/auth/realm";

describe("auth frontend contract", () => {
  it("distinguishes platform and tenant hosts", () => {
    expect(realmForHostname("trimmycrm.localhost")).toBe("platform");
    expect(realmForHostname("admin.trimmycrm.ru")).toBe("platform");
    expect(realmForHostname("lapushka.trimmycrm.localhost")).toBe("tenant");
    expect(realmForHostname("salon.example.ru")).toBe("tenant");
  });

  it("accepts only same-origin relative next paths", () => {
    expect(safeNextPath("/app/settings", "/app")).toBe("/app/settings");
    expect(safeNextPath("//evil.example", "/app")).toBe("/app");
    expect(safeNextPath("/\\evil.example", "/app")).toBe("/app");
    expect(safeNextPath("https://evil.example", "/app")).toBe("/app");
  });

  it("matches the backend password policy and confirmation", () => {
    const weak = registerSchema.safeParse({
      email: "owner@example.ru",
      password: "onlylowercase",
      passwordConfirm: "onlylowercase",
      termsAccepted: true,
      consent: true,
    });
    expect(weak.success).toBe(false);

    const valid = registerSchema.safeParse({
      email: "owner@example.ru",
      phone: "+79991234567",
      password: "Strong-pass1!",
      passwordConfirm: "Strong-pass1!",
      termsAccepted: true,
      consent: true,
    });
    expect(valid.success).toBe(true);
    expect(platformRegisterSchema.safeParse({
      email: "owner@example.ru",
      phone: "+79991234567",
      password: "Strong-pass1!",
      passwordConfirm: "Strong-pass1!",
      termsAccepted: true,
      consent: true,
      dataProcessingInstructionAccepted: true,
      salonName: "Форма",
      salonType: "women_hair_salon",
      city: "Москва",
      timezone: "Europe/Moscow",
    }).success).toBe(true);
    expect(platformRegisterSchema.safeParse({
      email: "owner@example.ru",
      phone: "+79991234567",
      password: "Strong-pass1!",
      passwordConfirm: "Strong-pass1!",
      termsAccepted: true,
      consent: true,
      dataProcessingInstructionAccepted: true,
      salonName: "Форма",
    }).success).toBe(false);
    expect(passwordChecks("Strong-pass1!").every((check) => check.met)).toBe(true);
  });
});
