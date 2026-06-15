import { toDecimal } from "@/lib/decimal";
import { AsientoEstado, type PrismaClient } from "@/generated/prisma/client";
import type { CuentaSaldo } from "./salud-balancete";

// Carga los saldos contabilizados por cuenta (debe/haber agregados) y los mapea
// a CuentaSaldo[] para alimentar detectarAnomaliasBalancete. Recibe el client
// por parámetro (el script de cron usa su propio PrismaClient; los tests usan el
// del contenedor), así que no depende de @/lib/db ni de server-only.
export async function cargarSaldosParaSalud(client: PrismaClient): Promise<CuentaSaldo[]> {
  const [cuentas, agregados] = await Promise.all([
    client.cuentaContable.findMany({
      select: { id: true, codigo: true, categoria: true, naturaleza: true, tipo: true },
    }),
    client.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: { asiento: { estado: AsientoEstado.CONTABILIZADO } },
      _sum: { debe: true, haber: true },
    }),
  ]);

  const aggByCuenta = new Map(agregados.map((a) => [a.cuentaId, a._sum]));

  return cuentas.map((c) => {
    const sum = aggByCuenta.get(c.id);
    return {
      codigo: c.codigo,
      categoria: c.categoria,
      naturaleza: c.naturaleza,
      tipo: c.tipo,
      debe: toDecimal(sum?.debe ?? 0),
      haber: toDecimal(sum?.haber ?? 0),
    };
  });
}
