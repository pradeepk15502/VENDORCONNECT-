import type { MessageKey } from "@vc/i18n";

/** Keep in sync with services/api/vc/catalog/models.py UNIT_CHOICES. */
export const UNIT_KEY: Record<string, MessageKey> = {
  kg: "unit.kg", g: "unit.g", l: "unit.l", ml: "unit.ml", piece: "unit.piece", dozen: "unit.dozen",
  packet: "unit.packet", bundle: "unit.bundle", box: "unit.box", pair: "unit.pair", strip: "unit.strip",
  bottle: "unit.bottle", meter: "unit.meter",
};

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** "2 kg" / "1 piece" — shared between customer search results and vendor product screens. */
export function formatUnit(t: T, unit: string, unitQuantity: string): string {
  const label = t(UNIT_KEY[unit] ?? "unit.piece");
  const qty = Number(unitQuantity);
  return qty && qty !== 1 ? `${unitQuantity} ${label}` : label;
}
