"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  crearDespachoAction,
  contabilizarDespachoAction,
} from "@/lib/actions/despachos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtMoney } from "@/lib/format";

type ItemDisponible = {
  itemEmbarqueId: number;
  productoCodigo: string;
  productoNombre: string;
  cantidadTotal: number;
  yaDespachado: number;
  remanente: number;
};

type FacturaOption = {
  id: number;
  label: string;
  totalArs: number;
};

type Props = {
  embarqueId: string;
  embarqueCodigo: string;
  embarqueMoneda: "ARS" | "USD";
  embarqueTipoCambio: string;
  depositoDestinoId: string | null;
  depositos: Array<{ id: string; nombre: string }>;
  items: ItemDisponible[];
  facturas: FacturaOption[];
};

export function CrearDespachoForm({
  embarqueId,
  embarqueCodigo,
  embarqueMoneda,
  embarqueTipoCambio,
  depositoDestinoId,
  depositos,
  items,
  facturas,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);

  const [fecha, setFecha] = useState(today);
  const [numeroOM, setNumeroOM] = useState("");
  const [tipoCambio, setTipoCambio] = useState(embarqueTipoCambio);
  const [die, setDie] = useState("0");
  const [tasaEstadistica, setTasa] = useState("0");
  const [arancelSim, setArancel] = useState("0");
  const [iva, setIva] = useState("0");
  const [ivaAdicional, setIvaAd] = useState("0");
  const [iibb, setIibb] = useState("0");
  const [ganancias, setGanancias] = useState("0");
  const [notas, setNotas] = useState("");

  // items[i].sel = boolean, items[i].cantidad = number
  const [itemsState, setItemsState] = useState(
    items.map((i) => ({ ...i, selected: false, cantidad: i.remanente })),
  );

  const [facturasIds, setFacturasIds] = useState<number[]>([]);

  const itemsSeleccionados = itemsState.filter((i) => i.selected);

  const totalTributosEmb = [die, tasaEstadistica, arancelSim, iva, ivaAdicional, iibb, ganancias]
    .map((v) => Number(v) || 0)
    .reduce((s, v) => s + v, 0);

  const handleSubmit = (contabilizarTrasCrear: boolean) => {
    if (itemsSeleccionados.length === 0) {
      toast.error("Seleccioná al menos un ítem.");
      return;
    }
    for (const it of itemsSeleccionados) {
      if (it.cantidad <= 0 || it.cantidad > it.remanente) {
        toast.error(
          `Cantidad inválida para ${it.productoCodigo}: máximo ${it.remanente}.`,
        );
        return;
      }
    }

    startTransition(async () => {
      const r = await crearDespachoAction({
        embarqueId,
        fecha,
        numeroOM: numeroOM || null,
        tipoCambio,
        die,
        tasaEstadistica,
        arancelSim,
        iva,
        ivaAdicional,
        iibb,
        ganancias,
        items: itemsSeleccionados.map((i) => ({
          itemEmbarqueId: i.itemEmbarqueId,
          cantidad: i.cantidad,
        })),
        facturasIds,
        notas: notas || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Despacho ${r.codigo} creado en BORRADOR.`);

      if (contabilizarTrasCrear) {
        const c = await contabilizarDespachoAction(r.despachoId);
        if (!c.ok) {
          toast.error(`Creado pero no contabilizado: ${c.error}`);
          router.refresh();
          return;
        }
        toast.success(`Asiento #${c.asientoNumero} contabilizado.`);
      }
      router.refresh();
    });
  };

  return (
    <form className="flex flex-col gap-3">
      {/* Header */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Fecha despacho</Label>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Nº OM oficializado</Label>
          <Input
            value={numeroOM}
            onChange={(e) => setNumeroOM(e.target.value)}
            placeholder="ej: 25001OM34..."
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">TC despacho</Label>
          <Input
            type="number"
            step="0.000001"
            value={tipoCambio}
            onChange={(e) => setTipoCambio(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Depósito destino</Label>
          <div className="flex h-8 items-center rounded-md border px-2.5 text-[13px] text-muted-foreground">
            {depositoDestinoId
              ? (depositos.find((d) => d.id === depositoDestinoId)?.nombre ??
                "—")
              : "(definir en el embarque)"}
          </div>
        </div>
      </div>

      {/* Tributos */}
      <fieldset className="rounded-md border p-2.5">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tributos del despacho ({embarqueMoneda})
        </legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          <DecimalInput label="DIE" value={die} onChange={setDie} />
          <DecimalInput
            label="Tasa Estad."
            value={tasaEstadistica}
            onChange={setTasa}
          />
          <DecimalInput
            label="Arancel SIM"
            value={arancelSim}
            onChange={setArancel}
          />
          <DecimalInput label="IVA" value={iva} onChange={setIva} />
          <DecimalInput label="IVA Ad." value={ivaAdicional} onChange={setIvaAd} />
          <DecimalInput label="IIBB" value={iibb} onChange={setIibb} />
          <DecimalInput
            label="Ganancias"
            value={ganancias}
            onChange={setGanancias}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Subtotal tributos: {embarqueMoneda} {fmtMoney(String(totalTributosEmb))}
        </p>
      </fieldset>

      {/* Items */}
      <fieldset className="rounded-md border p-2.5">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ítems a nacionalizar
        </legend>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-2.5 py-1.5"></th>
                <th className="px-2.5 py-1.5 text-left">Producto</th>
                <th className="px-2.5 py-1.5 text-right">Total</th>
                <th className="px-2.5 py-1.5 text-right">Ya despachado</th>
                <th className="px-2.5 py-1.5 text-right">Remanente</th>
                <th className="px-2.5 py-1.5 text-right w-32">A despachar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itemsState.map((it, idx) => (
                <tr
                  key={it.itemEmbarqueId}
                  className={it.selected ? "bg-primary/5" : undefined}
                >
                  <td className="px-2.5 py-1.5">
                    <Checkbox
                      checked={it.selected}
                      onCheckedChange={(v) => {
                        setItemsState((arr) =>
                          arr.map((x, i) =>
                            i === idx ? { ...x, selected: !!v } : x,
                          ),
                        );
                      }}
                    />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="font-mono text-[11px]">
                      {it.productoCodigo}
                    </span>{" "}
                    {it.productoNombre}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">{it.cantidadTotal}</td>
                  <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                    {it.yaDespachado}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-semibold">
                    {it.remanente}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={it.remanente}
                      value={it.cantidad}
                      disabled={!it.selected}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setItemsState((arr) =>
                          arr.map((x, i) =>
                            i === idx ? { ...x, cantidad: n } : x,
                          ),
                        );
                      }}
                      className="h-7 text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      {/* Facturas DESPACHO */}
      {facturas.length > 0 && (
        <fieldset className="rounded-md border p-2.5">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Facturas DESPACHO disponibles para linkar
          </legend>
          <div className="flex flex-col gap-1">
            {facturas.map((f) => {
              const checked = facturasIds.includes(f.id);
              return (
                <label
                  key={f.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setFacturasIds((cur) =>
                        v ? [...cur, f.id] : cur.filter((x) => x !== f.id),
                      );
                    }}
                  />
                  <span className="flex-1">{f.label}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    ARS {fmtMoney(String(f.totalArs))}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Notas */}
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Notas</Label>
        <Input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="opcional"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <span className="flex-1 text-[12px] text-muted-foreground">
          {embarqueCodigo} · {itemsSeleccionados.length} ítem
          {itemsSeleccionados.length === 1 ? "" : "s"} seleccionado
          {itemsSeleccionados.length === 1 ? "" : "s"} · {facturasIds.length}{" "}
          factura{facturasIds.length === 1 ? "" : "s"}
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => handleSubmit(false)}
          disabled={pending || itemsSeleccionados.length === 0}
        >
          {pending ? "Guardando…" : "Crear borrador"}
        </Button>
        <Button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={
            pending ||
            itemsSeleccionados.length === 0 ||
            !depositoDestinoId
          }
        >
          {pending ? "Procesando…" : "Crear y contabilizar"}
        </Button>
      </div>
    </form>
  );
}

function DecimalInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-right"
      />
    </div>
  );
}
