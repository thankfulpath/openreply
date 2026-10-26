import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/account-select", () => ({ default: () => null }));
vi.mock("@/components/post-picker", () => ({ default: () => null }));
vi.mock("@/components/campaign-preview", () => ({ default: () => null }));

import CampaignBuilder from "../components/campaign-builder";

describe("new campaign safety controls", () => {
  it("offers saving a new campaign paused before going live", () => {
    const html = renderToStaticMarkup(createElement(CampaignBuilder, { mode: "new" }));

    expect(html).toContain("Save Paused");
    expect(html).toContain("Go Live");
  });
});
