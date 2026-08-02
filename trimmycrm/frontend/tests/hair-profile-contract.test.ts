import { describe, expect, it } from "vitest";

import {
  hairCharacteristicLabel,
  hairProfileFormSchema,
  hairProfilePayload,
} from "../src/lib/app/hair-profile";

describe("hair profile frontend contract", () => {
  it("matches backend ranges and enumerations", () => {
    expect(hairProfileFormSchema.safeParse({
      hairLength: "long",
      density: "high",
      texture: "curly",
      porosity: "unknown",
      conditionNotes: "",
      scalpSensitivityNotes: "",
      grayPercentage: "35",
      naturalColor: "уровень 6",
      currentColor: "уровень 7",
      colorHistory: "",
      beardLength: "",
      beardStyle: "",
      moustacheStyle: "",
      preferences: "",
    }).success).toBe(true);
    expect(hairProfileFormSchema.safeParse({
      hairLength: "undefined",
      density: "",
      texture: "",
      porosity: "",
      conditionNotes: "",
      scalpSensitivityNotes: "",
      grayPercentage: "101",
      naturalColor: "",
      currentColor: "",
      colorHistory: "",
      beardLength: "",
      beardStyle: "",
      moustacheStyle: "",
      preferences: "",
    }).success).toBe(false);
  });

  it("clears blank fields and sends optimistic version", () => {
    const values = hairProfileFormSchema.parse({
      hairLength: "short",
      density: "",
      texture: "straight",
      porosity: "",
      conditionNotes: "  ",
      scalpSensitivityNotes: "",
      grayPercentage: "0",
      naturalColor: "",
      currentColor: "уровень 5",
      colorHistory: "",
      beardLength: "",
      beardStyle: "",
      moustacheStyle: "",
      preferences: "короткая укладка",
    });

    expect(hairProfilePayload(values, 4)).toMatchObject({
      hairLength: "short",
      density: null,
      conditionNotes: null,
      grayPercentage: 0,
      currentColor: "уровень 5",
      expectedVersion: 4,
    });
    expect(hairCharacteristicLabel("curly")).toBe("Кудрявые");
  });
});
