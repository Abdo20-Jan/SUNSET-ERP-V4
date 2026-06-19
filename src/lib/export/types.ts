// Especificación de una columna de export, agnóstica al formato (CSV/XLSX).
// `value(row)` extrae el valor crudo de la fila; la serialización (escape CSV,
// celda XLSX) la hace cada formateador.
export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null;
};
