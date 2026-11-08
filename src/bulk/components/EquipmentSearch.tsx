import React, { useId, useMemo } from 'react';
import Combobox from '@/app/components/generic/Combobox';
import { EquipmentOptionLabel } from '@/app/components/player/equipment/EquipmentSelect';
import {
  collapseVariants, EQUIPMENT_OPTIONS, EquipmentOption, sortForMonster,
} from '@/app/components/player/equipment/equipmentOptions';
import { CUSTOM_MONSTER_ID } from '@/lib/Monsters';
import { EquipmentPiece } from '@/types/Player';

// no monster is being fought here, so Gauntlet items sort last
const sortItems = (items: readonly EquipmentOption[]) => sortForMonster(items, CUSTOM_MONSTER_ID);

/**
 * Upstream's item search, picking an item for the caller instead of equipping it on the calculator's player.
 * @param filter which items to offer; keep it stable, as the list is rebuilt when it changes
 */
const EquipmentSearch: React.FC<{
  filter: (item: EquipmentPiece) => boolean;
  onPick: (item: EquipmentPiece) => void;
}> = ({ filter, onPick }) => {
  const id = useId();
  const items = useMemo(() => sortItems(EQUIPMENT_OPTIONS.filter((o) => filter(o.equipment))), [filter]);

  return (
    <Combobox<EquipmentOption>
      id={id}
      className="w-full"
      items={items}
      keepOpenAfterSelect
      keepPositionAfterSelect
      placeholder="Search for equipment..."
      onSelectedItemChange={(item) => item && onPick(item.equipment)}
      CustomItemComponent={EquipmentOptionLabel}
      customFilter={collapseVariants}
      customSort={sortItems}
    />
  );
};

export default EquipmentSearch;
