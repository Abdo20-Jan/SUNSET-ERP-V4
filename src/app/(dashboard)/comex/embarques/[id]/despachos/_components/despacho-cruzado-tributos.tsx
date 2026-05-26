"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { actualizarTributosDespachoCruzadoAction } from "@/lib/actions/despachos";
import { crearCostoDespachoCruzadoAction } from "@/lib/actions/despacho-cruzado-costos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProveedorCombobox, type ProveedorOption } from "@/components/proveedor-combobox";
import { CuentaCombobox, type CuentaOption } from "@/components/cuenta-combobox";
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
  embarqueTipoCambio: string;
  valores: TributosCruzadoValores;
  facturas: FacturaDespachoOption[];
  proveedores: ProveedorOption[];
  cuentasGasto: CuentaOption[];
};

// Editor inline de tributos/VEP del despacho CRUZADO en BORRADOR (gap #4).
// Reusa el layout del fieldset de `crear-despacho-form.tsx`: los montos son en
// la moneda del embarque y se convierten a ARS (VEP/asiento) con el TC al
// contabilizar. Permite (des)vincular facturas DESPACHO del embarque, y crear
// nuevas facturas de costo de nacionalización (despachante, fletes, etc.)
// inline, que quedan en BORRADOR y linkadas al despacho.
export function DespachoCruzadoTributosEditor({
  despachoId,
  codigo,
  embarqueMoneda,
  embarqueTipoCambio,
  valores,
  facturas,
  proveedores,
  cuentasGasto,
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

      <AgregarCostoDespachoForm
        despachoId={despachoId}
        embarqueMoneda={embarqueMoneda}
        embarqueTipoCambio={embarqueTipoCambio}
        proveedores={proveedores}
        cuentasGasto={cuentasGasto}
      />

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

type LineaState = {
  cuentaContableGastoId: number | null;
  descripcion: string;
  subtotal: string;
};

const lineaVacia = (): LineaState => ({
  cuentaContableGastoId: null,
  descripcion: "",
  subtotal: "0",
});

// Formulario inline "Agregar costo de nacionalización": crea una factura
// EmbarqueCosto (momento=DESPACHO, BORRADOR) linkada al despacho cruzado, con
// N líneas (cuenta de gasto + descripción + subtotal). NO emite asiento: la
// capitalización ocurre al contabilizar el despacho. Espeja el patrón de
// factura de costo del embarque-form, pero con estado local simple.
function AgregarCostoDespachoForm({
  despachoId,
  embarqueMoneda,
  embarqueTipoCambio,
  proveedores,
  cuentasGasto,
}: {
  despachoId: string;
  embarqueMoneda: "ARS" | "USD";
  embarqueTipoCambio: string;
  proveedores: ProveedorOption[];
  cuentasGasto: CuentaOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);

  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [moneda, setMoneda] = useState<"ARS" | "USD">(embarqueMoneda);
  const [tipoCambio, setTipoCambio] = useState(embarqueMoneda === "ARS" ? "1" : embarqueTipoCambio);
  const [facturaNumero, setFacturaNumero] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  const [iva, setIva] = useState("0");
  const [iibb, setIibb] = useState("0");
  const [otros, setOtros] = useState("0");
  const [lineas, setLineas] = useState<LineaState[]>([lineaVacia()]);

  const resetForm = () => {
    setProveedorId(null);
    setMoneda(embarqueMoneda);
    setTipoCambio(embarqueMoneda === "ARS" ? "1" : embarqueTipoCambio);
    setFacturaNumero("");
    setFechaFactura("");
    setIva("0");
    setIibb("0");
    setOtros("0");
    setLineas([lineaVacia()]);
  };

  const onSelectProveedor = (id: string) => {
    setProveedorId(id);
    // Auto-fill de la cuenta de gasto por defecto del proveedor en las líneas
    // que aún no tengan cuenta elegida (espejo del embarque-form).
    const prov = proveedores.find((p) => p.id === id);
    const cuentaDefault = prov?.cuentaGastoContableId ?? null;
    if (cuentaDefault != null) {
      setLineas((arr) =>
        arr.map((l) =>
          l.cuentaContableGastoId == null ? { ...l, cuentaContableGastoId: cuentaDefault } : l,
        ),
      );
    }
  };

  const subtotalLineas = lineas.map((l) => Number(l.subtotal) || 0).reduce((s, v) => s + v, 0);

  const guardar = () => {
    if (!proveedorId) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (lineas.length === 0 || lineas.some((l) => l.cuentaContableGastoId == null)) {
      toast.error("Cada línea necesita una cuenta de gasto.");
      return;
    }
    startTransition(async () => {
      const r = await crearCostoDespachoCruzadoAction({
        despachoId,
        proveedorId,
        moneda,
        tipoCambio,
        facturaNumero: facturaNumero || undefined,
        fechaFactura: fechaFactura || undefined,
        iva,
        iibb,
        otros,
        lineas: lineas.map((l) => ({
          cuentaContableGastoId: l.cuentaContableGastoId as number,
          descripcion: l.descripcion || undefined,
          subtotal: l.subtotal,
        })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Costo de nacionalización creado y linkado al despacho.");
      resetForm();
      setAbierto(false);
      router.refresh();
    });
  };

  if (!abierto) {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)}>
          + Agregar costo
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Despachante, fletes u otros gastos de nacionalización. Quedan en BORRADOR linkados a este
          despacho.
        </span>
      </div>
    );
  }

  return (
    <fieldset className="rounded-md border p-2.5">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Agregar costo de nacionalización
      </legend>
      <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label className="text-[11px]">Proveedor</Label>
          <ProveedorCombobox
            value={proveedorId}
            onChange={onSelectProveedor}
            proveedores={proveedores}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Moneda</Label>
          <select
            value={moneda}
            onChange={(e) => {
              const m = e.target.value as "ARS" | "USD";
              setMoneda(m);
              if (m === "ARS") setTipoCambio("1");
              else if (tipoCambio === "1") setTipoCambio(embarqueTipoCambio);
            }}
            className="h-8 rounded-md border bg-background px-2 text-[13px]"
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <DecimalInput
          label="TC factura"
          value={tipoCambio}
          onChange={setTipoCambio}
          step="0.000001"
        />
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Nº factura</Label>
          <Input
            value={facturaNumero}
            onChange={(e) => setFacturaNumero(e.target.value)}
            placeholder="opcional"
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Fecha factura</Label>
          <Input
            type="date"
            value={fechaFactura}
            onChange={(e) => setFechaFactura(e.target.value)}
            className="h-8"
          />
        </div>
      </div>

      <div className="mb-2 flex flex-col gap-2">
        {lineas.map((l, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: líneas locales sin id estable.
          <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div className="flex flex-col gap-1 md:col-span-5">
              {idx === 0 && <Label className="text-[11px]">Cuenta de gasto</Label>}
              <CuentaCombobox
                value={l.cuentaContableGastoId}
                onChange={(id) =>
                  setLineas((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, cuentaContableGastoId: id } : x)),
                  )
                }
                cuentas={cuentasGasto}
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-4">
              {idx === 0 && <Label className="text-[11px]">Descripción</Label>}
              <Input
                value={l.descripcion}
                onChange={(e) =>
                  setLineas((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, descripcion: e.target.value } : x)),
                  )
                }
                placeholder="opcional"
                className="h-8"
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              {idx === 0 && <Label className="text-[11px]">Subtotal</Label>}
              <Input
                type="number"
                step="0.01"
                min="0"
                value={l.subtotal}
                onChange={(e) =>
                  setLineas((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, subtotal: e.target.value } : x)),
                  )
                }
                className="h-8 text-right"
              />
            </div>
            <div className="flex items-end md:col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={lineas.length === 1}
                onClick={() => setLineas((arr) => arr.filter((_, i) => i !== idx))}
              >
                ✕
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLineas((arr) => [...arr, lineaVacia()])}
          >
            + Línea
          </Button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-2">
        <DecimalInput label="IVA" value={iva} onChange={setIva} />
        <DecimalInput label="IIBB" value={iibb} onChange={setIibb} />
        <DecimalInput label="Otros" value={otros} onChange={setOtros} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="flex-1 text-[11px] text-muted-foreground">
          Subtotal gastos: {moneda} {fmtMoney(String(subtotalLineas))}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            resetForm();
            setAbierto(false);
          }}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={guardar} disabled={pending}>
          {pending ? "Guardando…" : "Crear costo"}
        </Button>
      </div>
    </fieldset>
  );
}
