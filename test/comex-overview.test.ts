import { describe, expect, it } from "vitest";

import { EmbarqueEstado } from "@/generated/prisma/client";
import { resumirEmbarquesPorEstado } from "@/lib/services/comex-overview";

describe("resumirEmbarquesPorEstado", () => {
  it("lista vacía → todos los buckets en 0", () => {
    expect(resumirEmbarquesPorEstado([])).toEqual({
      total: 0,
      activos: 0,
      enTransito: 0,
      enAduana: 0,
      borradores: 0,
      cerrados: 0,
    });
  });

  it("agrupa estados mixtos en los buckets correctos", () => {
    const r = resumirEmbarquesPorEstado([
      { estado: EmbarqueEstado.BORRADOR, cantidad: 2 },
      { estado: EmbarqueEstado.EN_TRANSITO, cantidad: 3 },
      { estado: EmbarqueEstado.EN_PUERTO, cantidad: 1 },
      { estado: EmbarqueEstado.EN_ZONA_PRIMARIA, cantidad: 2 },
      { estado: EmbarqueEstado.EN_ADUANA, cantidad: 1 },
      { estado: EmbarqueEstado.DESPACHADO, cantidad: 1 },
      { estado: EmbarqueEstado.EN_DEPOSITO, cantidad: 1 },
      { estado: EmbarqueEstado.CERRADO, cantidad: 4 },
    ]);
    expect(r.total).toBe(15);
    expect(r.borradores).toBe(2);
    expect(r.cerrados).toBe(4);
    // activos = total − borradores − cerrados = 15 − 2 − 4
    expect(r.activos).toBe(9);
    // en tránsito = EN_TRANSITO + EN_PUERTO = 3 + 1
    expect(r.enTransito).toBe(4);
    // en aduana = EN_ZONA_PRIMARIA + EN_ADUANA + DESPACHADO = 2 + 1 + 1
    expect(r.enAduana).toBe(4);
  });

  it("EN_DEPOSITO cuenta como activo pero no entra en tránsito ni aduana", () => {
    const r = resumirEmbarquesPorEstado([{ estado: EmbarqueEstado.EN_DEPOSITO, cantidad: 5 }]);
    expect(r.activos).toBe(5);
    expect(r.enTransito).toBe(0);
    expect(r.enAduana).toBe(0);
  });

  it("solo borradores → activos 0", () => {
    const r = resumirEmbarquesPorEstado([{ estado: EmbarqueEstado.BORRADOR, cantidad: 7 }]);
    expect(r.total).toBe(7);
    expect(r.activos).toBe(0);
    expect(r.borradores).toBe(7);
  });
});
