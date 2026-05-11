export const THERMAL_WIDTHS = ['thermal2', 'thermal3', 'thermal4'] as const;

export type ThermalWidth = (typeof THERMAL_WIDTHS)[number];

const LABELS: Record<ThermalWidth, string> = {
  thermal2: '58mm (2")',
  thermal3: '80mm (3")',
  thermal4: '112mm (4")',
};

export const PAPER_WIDTH_OPTIONS = THERMAL_WIDTHS.map((value) => ({
  value,
  label: LABELS[value],
}));

export function paperWidthLabel(value: string): string {
  return LABELS[value as ThermalWidth] ?? value;
}
