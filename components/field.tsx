"use client";

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string | null;
  maxLength?: number;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-[var(--muted)]">{props.label}</span>
      <input
        required={!props.optional}
        type={props.type ?? "text"}
        value={props.value}
        maxLength={props.maxLength}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className={`w-full rounded-2xl border bg-[var(--surface)] px-4 py-3.5 outline-none transition-colors focus:border-[var(--accent)] ${
          props.error ? "border-[var(--danger)]" : "border-[var(--border)]"
        }`}
      />
      {props.error && <span className="mt-1.5 block text-xs text-[var(--danger)]">{props.error}</span>}
    </label>
  );
}
