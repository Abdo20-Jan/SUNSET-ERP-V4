type Deposito = { id: string; nombre: string };

type StockPorDep = {
  depositoId: string;
  cantidadFisica: number;
  cantidadReservada: number;
};

type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  stockActual: number;
  stockPorDeposito: StockPorDep[];
};

export function InventarioMatrix({
  productos,
  depositos,
}: {
  productos: Producto[];
  depositos: Deposito[];
}) {
  const colspan = 2 + depositos.length * 3;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">Total</th>
            {depositos.map((d) => (
              <th key={d.id} className="px-3 py-2 text-right" colSpan={3}>
                {d.nombre}
              </th>
            ))}
          </tr>
          <tr className="text-xs text-muted-foreground">
            <th className="px-3 py-1" />
            <th className="px-3 py-1" />
            {depositos.map((d) => (
              <SubHeader key={d.id} />
            ))}
          </tr>
        </thead>
        <tbody>
          {productos.length === 0 ? (
            <tr>
              <td
                colSpan={colspan}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                Sin resultados.
              </td>
            </tr>
          ) : (
            productos.map((p) => (
              <ProductoRow key={p.id} producto={p} depositos={depositos} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SubHeader() {
  return (
    <>
      <th className="px-3 py-1 text-right font-normal">Físico</th>
      <th className="px-3 py-1 text-right font-normal">Reservado</th>
      <th className="px-3 py-1 text-right font-normal">Disponible</th>
    </>
  );
}

function ProductoRow({
  producto,
  depositos,
}: {
  producto: Producto;
  depositos: Deposito[];
}) {
  const byDep = new Map(producto.stockPorDeposito.map((s) => [s.depositoId, s]));
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{producto.codigo}</div>
        <div>{producto.nombre}</div>
      </td>
      <td className="px-3 py-2 text-right font-medium">
        {producto.stockActual}
      </td>
      {depositos.map((d) => {
        const s = byDep.get(d.id);
        const fisica = s?.cantidadFisica ?? 0;
        const reservada = s?.cantidadReservada ?? 0;
        return (
          <Cells
            key={d.id}
            fisica={fisica}
            reservada={reservada}
            disponible={fisica - reservada}
          />
        );
      })}
    </tr>
  );
}

function Cells({
  fisica,
  reservada,
  disponible,
}: {
  fisica: number;
  reservada: number;
  disponible: number;
}) {
  return (
    <>
      <td className="px-3 py-2 text-right">{fisica}</td>
      <td className="px-3 py-2 text-right text-amber-700">
        {reservada || "—"}
      </td>
      <td className="px-3 py-2 text-right font-medium">{disponible}</td>
    </>
  );
}
