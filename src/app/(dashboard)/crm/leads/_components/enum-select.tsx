"use client";

export function EnumSelect({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: readonly string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border px-3 py-2"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
