import { describe, expect, it } from "vitest";

import { classifyRouteError } from "@/lib/route-error";

describe("classifyRouteError", () => {
  it('detecta "column ... does not exist" como schema', () => {
    expect(classifyRouteError('column "x" does not exist')).toBe("schema");
  });

  it("detecta Prisma P2022 como schema", () => {
    expect(classifyRouteError("Prisma P2022 ...")).toBe("schema");
  });

  it("clasifica un mensaje cualquiera como generic", () => {
    expect(classifyRouteError("boom")).toBe("generic");
  });

  it("clasifica undefined como generic", () => {
    expect(classifyRouteError(undefined)).toBe("generic");
  });
});
