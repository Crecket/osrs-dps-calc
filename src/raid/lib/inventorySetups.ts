// Worker-safe: no state, React or app imports.

type Slot = { id: number } | null;
interface SetupJson {
  eq?: Slot[];
  inv?: Slot[];
  qv?: Slot[];
  afi?: Record<string, { id: number }>;
}

const isSetup = (v: unknown): v is SetupJson => !!v && typeof v === 'object'
  && (Array.isArray((v as SetupJson).eq) || Array.isArray((v as SetupJson).inv));

/**
 * The item ids in a RuneLite Inventory Setups export (worn, inventory, quiver and additional filtered items), without
 * duplicates. Accepts the whole export or its `setup` object.
 */
// eslint-disable-next-line import/prefer-default-export
export const parseInventorySetup = (text: string): number[] => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not an Inventory Setups export');
  }
  const setup = isSetup(raw) ? raw : (raw as { setup?: unknown } | null)?.setup;
  if (!isSetup(setup)) throw new Error('Not an Inventory Setups export');

  const ids = [...(setup.eq ?? []), ...(setup.inv ?? []), ...(setup.qv ?? [])]
    .filter((s): s is { id: number } => !!s && typeof s.id === 'number')
    .map((s) => s.id);
  Object.values(setup.afi ?? {}).forEach((s) => {
    if (s && typeof s.id === 'number') ids.push(s.id);
  });
  return [...new Set(ids)];
};
