import { LEAD_ESTADOS, LEAD_FUENTES } from "@/lib/crm-enums";

export function LeadsFilterBar({
  q,
  estado,
  fuente,
}: {
  q: string | undefined;
  estado: string | undefined;
  fuente: string | undefined;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      <label className="flex flex-col text-sm">
        <span className="text-muted-foreground">Buscar</span>
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Nombre, empresa, CUIT, email"
          className="rounded-md border px-3 py-1.5"
        />
      </label>
      <label className="flex flex-col text-sm">
        <span className="text-muted-foreground">Estado</span>
        <select name="estado" defaultValue={estado ?? ""} className="rounded-md border px-3 py-1.5">
          <option value="">Todos</option>
          {LEAD_ESTADOS.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        <span className="text-muted-foreground">Fuente</span>
        <select name="fuente" defaultValue={fuente ?? ""} className="rounded-md border px-3 py-1.5">
          <option value="">Todas</option>
          {LEAD_FUENTES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md border px-3 py-1.5 hover:bg-muted"
      >
        Filtrar
      </button>
    </form>
  );
}
