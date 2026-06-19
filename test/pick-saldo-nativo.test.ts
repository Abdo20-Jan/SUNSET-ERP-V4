import { describe, expect, it } from "vitest";

// Rollout USD de tesorería — helper `pickSaldoNativo`.
//
// Préstamos y cuentas a pagar traen el saldo ya partido por moneda nativa:
// `saldoUsd` presente ⇒ la posición es USD-nativa (invariante #257), `saldoUsd`
// ausente (null/undefined) ⇒ es ARS. El helper elige el par (valor, moneda
// nativa) correcto para alimentar `fmtMontoPres` en la presentación, evitando
// re-dividir un USD nativo o perder el "1 a 1".
import { pickSaldoNativo } from "@/lib/format";

describe("pickSaldoNativo", () => {
  it("saldoUsd presente → USD nativo (no se toca saldoArs)", () => {
    expect(pickSaldoNativo("130000.00", "100.00")).toEqual({
      valor: "100.00",
      monedaNativa: "USD",
    });
  });

  it("saldoUsd null → ARS nativo", () => {
    expect(pickSaldoNativo("130000.00", null)).toEqual({
      valor: "130000.00",
      monedaNativa: "ARS",
    });
  });

  it("saldoUsd undefined → ARS nativo", () => {
    expect(pickSaldoNativo("5000.00", undefined)).toEqual({
      valor: "5000.00",
      monedaNativa: "ARS",
    });
  });

  it("saldoUsd '0' (USD-nativo con saldo cero) sigue siendo USD", () => {
    expect(pickSaldoNativo("0.00", "0")).toEqual({
      valor: "0",
      monedaNativa: "USD",
    });
  });
});
