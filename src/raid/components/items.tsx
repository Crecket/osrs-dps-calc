import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { EquipmentPiece } from '@/types/Player';
import { getCdnImage } from '@/utils';
import { useRaidStore } from '@/raid/state/RaidStore';
import { itemPrice, Prices } from '@/raid/lib/prices';
import { formatGp } from '@/raid/lib/format';
import { RAIDS } from '@/raid/raids';
import { bossImage } from '@/raid/lib/route';

let itemsById: Map<number, EquipmentPiece> | null = null;
export const itemById = (id: number) => {
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  return itemsById.get(id);
};

export const ItemImage: React.FC<{ id: number; size?: number }> = ({ id, size = 28 }) => {
  const item = itemById(id);
  if (!item?.image) return null;
  return <img style={{ maxWidth: size, maxHeight: size }} src={getCdnImage(`equipment/${item.image}`)} alt={item.name} loading="lazy" />;
};

/** A boss's picture, fitted in a square */
export const BossImage: React.FC<{ bossId: string; size?: number }> = ({ bossId, size = 28 }) => {
  const boss = RAIDS.flatMap((r) => r.stops.flatMap((st) => st.options)).find((b) => b.id === bossId);
  const image = boss && bossImage(boss);
  if (!image) return null;
  return (
    <span className="shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <img className="max-w-full max-h-full object-contain" src={getCdnImage(`monsters/${image}`)} alt={boss.name} loading="lazy" />
    </span>
  );
};

/** "Owned", "Untradeable or no price" or the GP price */
export const priceLabel = (id: number, prices: Prices | null, owned: number[]) => {
  if (owned.includes(getCanonicalItemId(id))) return 'owned';
  const price = itemPrice(id, prices, new Set());
  return price > 0 ? `${formatGp(price)} gp` : 'free (untradeable or no price)';
};

export interface MenuTarget {
  id: number;
  x: number;
  y: number;
}

/** The right-click menu of an item: exclude it, or mark it owned or not owned */
export const ItemMenu: React.FC<{ target: MenuTarget | null; onClose: () => void }> = observer(({ target, onClose }) => {
  const store = useRaidStore();
  useEffect(() => {
    if (!target) return undefined;
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [target, onClose]);
  if (!target) return null;
  const owned = store.settings.ownedIds.includes(getCanonicalItemId(target.id));
  const entry = 'block w-full text-left px-3 py-1.5 text-sm hover:bg-orange-400 hover:text-white';
  return (
    <div
      role="menu"
      className="fixed z-50 min-w-[10rem] rounded shadow-lg border border-body-400 dark:border-dark-200 bg-white dark:bg-dark-400 text-black dark:text-white py-1"
      style={{ left: target.x, top: target.y }}
    >
      <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-300">{itemById(target.id)?.name}</div>
      <button type="button" role="menuitem" className={entry} onClick={() => store.exclude(target.id)}>Exclude</button>
      <button type="button" role="menuitem" className={entry} onClick={() => store.toggleOwned(target.id)}>
        {owned ? 'Unmark owned' : 'Mark owned'}
      </button>
    </div>
  );
});

/** State and handler for an ItemMenu */
export const useItemMenu = () => {
  const [target, setTarget] = useState<MenuTarget | null>(null);
  const open = (id: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setTarget({ id, x: e.clientX, y: e.clientY });
  };
  return { target, open, close: () => setTarget(null) };
};
