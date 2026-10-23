import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { StoreProvider, useStore } from '@/state';
import Prayers from '@/app/components/player/Prayers';
import SkillInput from '@/app/components/player/skills/SkillInput';
import UsernameLookup from '@/app/components/player/skills/UsernameLookup';
import BuffItem from '@/app/components/player/buffs/BuffItem';
import Potion from '@/enums/Potion';
import { PotionMap } from '@/utils';
import attack from '@/public/img/bonuses/attack.png';
import strength from '@/public/img/bonuses/strength.png';
import defence from '@/public/img/bonuses/defence.png';
import ranged from '@/public/img/bonuses/ranged.png';
import magic from '@/public/img/bonuses/magic.png';
import hitpoints from '@/public/img/bonuses/hitpoints.png';
import prayer from '@/public/img/tabs/prayer.png';
import BuffIcons from '@/bulk/components/BuffIcons';
import useSetupStore from '@/bulk/components/useSetupStore';
import { BulkSetup } from '@/bulk/types';

export type QuickEditKind = 'prayers' | 'potions' | 'levels';

// upstream's potion list, as in its Skills panel, bound to whichever store is provided
const PotionList: React.FC = observer(() => {
  const store = useStore();
  return (
    <div className="w-64 max-h-72 overflow-y-auto bg-white dark:bg-dark-500 rounded border border-gray-300 dark:border-dark-200">
      {Object.entries(PotionMap).sort((a, b) => a[1].order - b[1].order).map(([k, v]) => {
        const potion: Potion = parseInt(k);
        return (
          <BuffItem
            key={k}
            potion={potion}
            name={v.name}
            image={v.image}
            active={store.player.buffs.potions.includes(potion)}
            setActive={store.togglePlayerPotion}
          />
        );
      })}
    </div>
  );
});

const LevelInputs: React.FC = () => (
  <div className="w-[26rem]">
    <UsernameLookup />
    {/* upstream's own grid (each skill is an icon cell and an input cell), with room for the icons */}
    <div className="mt-3 grid items-center gap-x-2 gap-y-1 [&_img]:min-w-[21px]" style={{ gridTemplateColumns: 'auto 1fr auto 1fr' }}>
      <SkillInput name="Attack" field="atk" image={attack} />
      <SkillInput name="Strength" field="str" image={strength} />
      <SkillInput name="Defence" field="def" image={defence} />
      <SkillInput name="Hitpoints" field="hp" image={hitpoints} />
      <SkillInput name="Ranged" field="ranged" image={ranged} />
      <SkillInput name="Magic" field="magic" image={magic} />
      <SkillInput name="Prayer" field="prayer" image={prayer} />
    </div>
  </div>
);

/**
 * A popover with upstream's own controls, editing one setup through a private calculator store.
 */
const QuickEditPopover: React.FC<{ setupId: string; kind: QuickEditKind; onClose: () => void }> = ({ setupId, kind, onClose }) => {
  const calc = useSetupStore(setupId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-20 top-full left-0 mt-1 p-2 rounded shadow-xl bg-tile dark:bg-dark-300 border border-body-300 dark:border-dark-200 text-black dark:text-white">
      <StoreProvider store={calc}>
        {kind === 'prayers' && <div className="-mx-4 -mb-8"><Prayers /></div>}
        {kind === 'potions' && <PotionList />}
        {kind === 'levels' && <LevelInputs />}
      </StoreProvider>
    </div>
  );
};

const chip = 'flex items-center justify-center gap-0.5 h-8 min-w-[4.25rem] px-1.5 shrink-0 rounded border border-body-300 dark:border-dark-200 bg-body-100 dark:bg-dark-400 hover:border-orange-400 text-xs whitespace-nowrap';

const levelsLabel = (s: BulkSetup['player']['skills']) => {
  const combat = [s.atk, s.str, s.def, s.ranged, s.magic, s.hp, s.prayer];
  return combat.every((l) => l === 99) ? '99s' : `${s.atk}/${s.str}/${s.def} · ${s.ranged} · ${s.magic}`;
};

/**
 * Previews of a setup's prayers, potions and levels; each opens upstream's controls to change them.
 */
const SetupQuickEdit: React.FC<{ setup: BulkSetup; open: QuickEditKind | null; onOpen: (k: QuickEditKind | null) => void }> = observer(({
  setup, open, onOpen,
}) => {
  const { prayers, buffs, skills } = setup.player;
  const toggle = (k: QuickEditKind) => onOpen(open === k ? null : k);

  return (
    <div className="relative flex gap-1">
      <button type="button" className={chip} aria-label="Prayers" title="Prayers" onClick={() => toggle('prayers')}>
        {prayers.length === 0 ? '+ Prayer' : <BuffIcons player={setup.player} which="prayers" />}
      </button>
      <button type="button" className={chip} aria-label="Potions" title="Potions" onClick={() => toggle('potions')}>
        {buffs.potions.length === 0 ? '+ Potion' : <BuffIcons player={setup.player} which="potions" />}
      </button>
      <button type="button" className={chip} aria-label="Levels" title="Levels" onClick={() => toggle('levels')}>
        {levelsLabel(skills)}
      </button>
      {open && <QuickEditPopover setupId={setup.id} kind={open} onClose={() => onOpen(null)} />}
    </div>
  );
});

export default SetupQuickEdit;
