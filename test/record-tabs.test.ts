import { describe, expect, it } from "vitest";

import { resolveActiveTab } from "@/lib/record-tabs";

const TABS = ["general", "compras", "pagos", "anticipos"] as const;

describe("resolveActiveTab", () => {
  it("devuelve el tab cuando está en la allowlist", () => {
    expect(resolveActiveTab("compras", TABS, "general")).toBe("compras");
    expect(resolveActiveTab("anticipos", TABS, "general")).toBe("anticipos");
  });

  it("cae al fallback con tab desconocido", () => {
    expect(resolveActiveTab("inexistente", TABS, "general")).toBe("general");
  });

  it("cae al fallback con undefined o vacío", () => {
    expect(resolveActiveTab(undefined, TABS, "general")).toBe("general");
    expect(resolveActiveTab("", TABS, "general")).toBe("general");
  });
});
