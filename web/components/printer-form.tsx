import Link from 'next/link';
import type { Printer } from '@/lib/db/schema';

type Defaults = Partial<
  Pick<Printer, 'id' | 'name' | 'macAddress' | 'branchCode' | 'isActive'>
>;

type Props = {
  action: (fd: FormData) => void | Promise<void>;
  defaultValues?: Defaults;
  error?: string;
  submitLabel: string;
};

export function PrinterForm({
  action,
  defaultValues,
  error,
  submitLabel,
}: Props) {
  return (
    <form action={action} className="space-y-5">
      {defaultValues?.id && (
        <input type="hidden" name="id" value={defaultValues.id} />
      )}

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Field
        label="Name"
        name="name"
        defaultValue={defaultValues?.name ?? ''}
        required
        placeholder="Branch BKK01"
      />

      <Field
        label="MAC Address"
        name="macAddress"
        defaultValue={defaultValues?.macAddress ?? ''}
        required
        placeholder="00:11:62:00:00:01"
        pattern="[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}"
        hint="Hex bytes separated by colons (lower or upper case)"
      />

      <Field
        label="Branch code"
        name="branchCode"
        defaultValue={defaultValues?.branchCode ?? ''}
        placeholder="BKK01"
        hint="Used for routing — Zoho's branchCode field must match"
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={defaultValues?.isActive ?? true}
          className="h-4 w-4 rounded border-gray-300"
        />
        <span>Active (uncheck to disable polling for this printer)</span>
      </label>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          {submitLabel}
        </button>
        <Link
          href="/printers"
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  placeholder,
  pattern,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  pattern?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        pattern={pattern}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
