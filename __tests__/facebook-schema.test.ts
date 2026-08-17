import { describe, expect, it } from "vitest";
import {
  AutomationPlatform,
  Prisma,
} from "../app/generated/prisma/client";

describe("Facebook Prisma contract", () => {
  it("exposes Facebook as an automation platform and Page model", () => {
    expect(AutomationPlatform).toEqual({
      INSTAGRAM: "INSTAGRAM",
      FACEBOOK: "FACEBOOK",
    });
    expect(Prisma.ModelName.FacebookPage).toBe("FacebookPage");
  });
});
