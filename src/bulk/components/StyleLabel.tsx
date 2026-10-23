import React from 'react';
import { observer } from 'mobx-react-lite';
import { Player } from '@/types/Player';
import { spellIcon, styleLabel } from '@/bulk/lib/format';

/**
 * The setup's attack style, or the spell it casts (with the spell's icon).
 */
const StyleLabel: React.FC<{ player: Player; className?: string }> = observer(({ player, className = '' }) => {
  const icon = spellIcon(player);
  const label = styleLabel(player);
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-300 ${className}`} title={label}>
      {icon && <img src={icon} alt="" className="w-4 h-4 object-contain shrink-0" />}
      <span className="truncate">{icon ? label : `(${label})`}</span>
    </span>
  );
});

export default StyleLabel;
