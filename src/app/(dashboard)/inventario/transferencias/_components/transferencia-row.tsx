import type { TransferenciaEstado } from "@/generated/prisma/client";
import { fmtDate } from "@/lib/format";

import { TransferenciaActions } from "./transferencia-actions";

type Row = {
  id: string;
  numero: string;
  fecha: Date;
  cantidad: number;
  estado: TransferenciaEstado;
  observacion: string | null;
  producto: { codigo: string; nombre: string };
  origen: { id: string; nombre: string };
  destino: { id: string; nombre: string };
};

export function TransferenciaRow({ t }: { t: Row }) {
  const estadoCls =
    t.estado === "CONFIRMADA"
      ? "font-medium text-green-700"
      : "text-red-700";
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-mono text-xs">{t.numero}</td>
      <td className="px-3 py-2">{fmtDate(t.fecha)}</td>
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{t.producto.codigo}</div>
        <div>{t.producto.nombre}</div>
      </td>
      <td className="px-3 py-2 text-right font-medium">{t.cantidad}</td>
      <td className="px-3 py-2">
        {t.origen.nombre} → {t.destino.nombre}
      </td>
      <td className="px-3 py-2">
        <span className={estadoCls}>{t.estado}</span>
      </td>
      <td className="px-3 py-2">
        <TransferenciaActions transferenciaId={t.id} estado={t.estado} />
      </td>
    </tr>
  );
}
