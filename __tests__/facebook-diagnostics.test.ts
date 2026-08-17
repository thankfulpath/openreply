import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Facebook diagnostics", () => {
  const route = readFileSync("app/api/admin/diagnostics/route.ts", "utf8");

  it("reports the platform and Messenger follow-up outcome without tokens", () => {
    expect(route).toContain("platform: true");
    expect(route).toContain("followUpError: true");
    expect(route).toContain("followUpSentAt: true");
    expect(route).not.toContain("accessToken: true");
  });
});
