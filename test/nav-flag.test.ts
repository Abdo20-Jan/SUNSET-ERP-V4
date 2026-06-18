import { describe, expect, it } from "vitest";
import { resolveNavVariant, UI_NAV_COOKIE } from "@/lib/nav/nav-flag";

describe("resolveNavVariant", () => {
  it("default (undefined) → sidebar", () => expect(resolveNavVariant(undefined)).toBe("sidebar"));
  it("'topnav' → topnav", () => expect(resolveNavVariant("topnav")).toBe("topnav"));
  it("cualquier otro valor → sidebar", () => expect(resolveNavVariant("xyz")).toBe("sidebar"));
  it("cookie name", () => expect(UI_NAV_COOKIE).toBe("ui_nav"));
});
