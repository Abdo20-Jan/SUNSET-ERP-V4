"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { actualizarTributosDespachoCruzadoAction } from "@/lib/actions/despachos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney } from "@/lib/format";

export type FacturaDespachoOption = {
  id: number;
  label: string;
  totalArs: number;
};

export type TributosCruzadoValores = {
  tipoCambio: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva: string;
  ivaAdicional: string;
  iibb: string;
  ganancias: string;
  numeroOM: string | null;
  facturasIds: number[];
};

type Props = {
  despachoId: string;
  codigo: string;
  embarqueMoneda: "ARS" | "USD";
  valores: TributosCruzadoValores;
  facturas: FacturaDespachoOption[];
};

// Editor inline de tributos/VEP del despacho CRUZADO en BORRADOR (gap #4).
// Reusa el layout del fieldset de `crear-despacho-form.tsx`: los montos son en
// la moneda del embarque y se convierten a ARS (VEP/asiento) con el TC al
// contabilizar. Permite (des)vincular facturas DESPACHO del embarque.
export function DespachoCruzadoTributosEditor({
  despachoId,
  codigo,
  embarqueMoneda,
  valores,
  facturas,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tipoCambio, setTipoCambio] = useState(valores.tipoCambio);
  const [die, setDie] = useState(valores.die);
  const [tasaEstadistica, setTasa] = useState(valores.tasaEstadistica);
  const [arancelSim, setArancel] = useState(valores.arancelSim);
  const [iva, setIva] = useState(valores.iva);
  const [ivaAdicional, setIvaAd] = useState(valores.ivaAdicional);
  const [iibb, setIibb] = useState(valores.iibb);
  const [ganancias, setGanancias] = useState(valores.ganancias);
  const [numeroOM, setNumeroOM] = useState(valores.numeroOM ?? "");
  const [facturasIds, setFacturasIds] = useState<number[]>(valores.facturasIds);

  const totalTributosEmb = [die, tasaEstadistica, arancelSim, iva, ivaAdicional, iibb, ganancias]
    .map((v) => Number(v) || 0)
    .reduce((s, v) => s + v, 0);
  const tcNum = Number(tipoCambio) || 0;
  const vepEstimado = totalTributosEmb * tcNum;

  const guardar = () =>
    startTransition(async () => {
      const r = await actualizarTributosDespachoCruzadoAction({
        despachoId,
        tipoCambio,
        die,
        tasaEstadistica,
        arancelSim,
        iva,
        ivaAdicional,
        iibb,
        ganancias,
        numeroOM: numeroOM || null,
        facturasIds,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Tributos de ${codigo} guardados — ya podés contabilizar.`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="rounded-md border p-2.5">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nacionalización — tributos y gastos ({embarqueMoneda})
        </legend>
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <DecimalInput
            label="TC despacho"
            value={tipoCambio}
            onChange={setTipoCambio}
            step="0.000001"
          />
          <div className="flex flex-col gap-1 md:col-span-3">
            <Label className="text-[11px]">Nº OM oficializado</Label>
            <Input
              value={numeroOM}
              onChange={(e) => setNumeroOM(e.target.value)}
              placeholder="ej: 25001OM34..."
              className="h-8"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          <DecimalInput label="DIE" value={die} onChange={setDie} />
          <DecimalInput label="Tasa Estad." value={tasaEstadistica} onChange={setTasa} />
          <DecimalInput label="Arancel SIM" value={arancelSim} onChange={setArancel} />
          <DecimalInput label="IVA" value={iva} onChange={setIva} />
          <DecimalInput label="IVA Ad." value={ivaAdicional} onChange={setIvaAd} />
          <DecimalInput label="IIBB" value={iibb} onChange={setIibb} />
          <DecimalInput label="Ganancias" value={ganancias} onChange={setGanancias} />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Subtotal tributos: {embarqueMoneda} {fmtMoney(String(totalTributosEmb))} · VEP estimado:
          ARS {fmtMoney(String(vepEstimado))}
        </p>
      </fieldset>

      {facturas.length > 0 && (
        <fieldset className="rounded-md border p-2.5">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Facturas DESPACHO para linkar
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
                      setFacturasIds((cur) => (v ? [...cur, f.id] : cur.filter((x) => x !== f.id)));
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

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="flex-1 text-[12px] text-muted-foreground">
          {facturasIds.length} factura{facturasIds.length === 1 ? "" : "s"} linkada
          {facturasIds.length === 1 ? "" : "s"}. Guardá los tributos antes de contabilizar el
          despacho.
        </span>
        <Button type="button" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Guardar tributos"}
        </Button>
      </div>
    </div>
  );
}

function DecimalInput({
  label,
  value,
  onChange,
  step = "0.01",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        step={step}
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-right"
      />
    </div>
  );
}
