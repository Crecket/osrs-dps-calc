import { DefenceCounts, PhasePart, RaidDef } from '@/raid/types';

// Defence reduction defaults: the community's optimal specs per boss (Ralos counts hitsplats, as the engine does)
const specs = (elderMaul: number, tonalztic: number): DefenceCounts => ({ elderMaul, dwh: 0, tonalztic });
// can't be meleed the whole fight: half the health bar is ranged
const HALF_RANGED: PhasePart[] = [{ styles: ['ranged'], share: 0.5 }, { share: 0.5 }];
// a third of the health bar is ranged
const THIRD_RANGED: PhasePart[] = [{ styles: ['ranged'], share: 1 / 3 }, { share: 2 / 3 }];
const MELEE: PhasePart['styles'] = ['stab', 'slash', 'crush'];

const fracturedArchive: RaidDef = {
  id: 'fractured-archive',
  name: 'The Fractured Archive',
  stops: [
    {
      id: 'guardian',
      label: 'Archive Guardian',
      options: [{
        id: 'guardian',
        name: 'Archive Guardian',
        phases: [
          {
            key: 'guardian:0',
            label: 'Flying',
            monsterId: 16659,
            version: 'Flying',
            defaults: specs(0, 4),
            // out of melee reach while flying
            allowedStyles: ['ranged', 'magic'],
          },
          {
            key: 'guardian:1', label: 'Grounded', monsterId: 16659, version: 'Grounded', defaults: specs(0, 4),
          },
        ],
      }],
    },
    {
      id: 'second',
      label: 'Bork or Ezekiel',
      options: [
        {
          id: 'bork',
          name: 'Bork',
          phases: [
            // Bork walks with 8-14 flat armour (more as the Smorks lose health); in a duo the tank melees him while the
            // other ranges, so half of it is each. A heavy cannonball stuns him after about 30s, with no flat armour and
            // every hit landing: the other 75% of his health is dealt then, in any style
            {
              key: 'bork:0',
              label: 'Bork',
              monsterId: 16640,
              version: '',
              defaults: specs(2, 0),
              parts: [{ styles: ['ranged'], share: 0.5 }, { styles: MELEE, share: 0.5 }],
              hpShare: 0.25,
              state: { enginePhase: 'Smork HP 75% - 50%', flatArmour: 10 },
            },
            {
              key: 'bork:2',
              label: 'Bork (stunned)',
              monsterId: 16640,
              version: '',
              // the specs are done while he walks, and their drain stays
              defaults: specs(0, 0),
              defenceFrom: 'bork:0',
              hpShare: 0.75,
              state: { enginePhase: 'Stunned', flatArmour: 0, alwaysHit: true },
            },
            {
              key: 'bork:1', label: 'The Smorks', monsterId: 16641, version: '', defaults: specs(2, 4),
            },
          ],
        },
        {
          id: 'ezekiel',
          name: 'Ezekiel',
          phases: [{
            key: 'ezekiel:0', label: 'Ezekiel', monsterId: 16652, version: '', defaults: specs(2, 0),
          }],
        },
      ],
    },
    {
      id: 'third',
      label: 'Moia or Dreadnoth',
      options: [
        {
          id: 'moia',
          name: 'Moia',
          phases: [{
            key: 'moia:0', label: 'Moia', monsterId: 16667, version: '', defaults: specs(0, 2),
          }],
          // the Venator bow hits the binders mid-shuffle
          rules: { requiredItemIds: [27610] },
        },
        {
          id: 'dreadnoth',
          name: 'Dreadnoth',
          phases: [{
            key: 'dreadnoth:0',
            label: 'Dreadnoth',
            monsterId: 16665,
            version: '',
            defaults: specs(0, 5),
            parts: [{ styles: ['ranged'], share: 0.7 }, { share: 0.3 }],
          }],
        },
      ],
    },
    {
      id: 'fourth',
      label: 'Dagon\'hai or Xarth',
      options: [
        {
          id: 'dagonhai',
          name: 'The Dagon\'hai',
          phases: [
            {
              key: 'dagonhai:0', label: 'Elder', monsterId: 16643, version: '', defaults: specs(0, 3),
            },
            {
              key: 'dagonhai:1', label: 'Monk (book)', monsterId: 16647, version: 'Book', defaults: specs(0, 3),
            },
            {
              key: 'dagonhai:2', label: 'Monk (staff)', monsterId: 16645, version: 'Staff', defaults: specs(0, 3),
            },
          ],
          rules: { forbiddenMagic: { options: ['thralls', 'ancients'], reason: 'The Dagon\'hai need elemental spells' } },
        },
        {
          id: 'xarth',
          name: 'Xarth',
          phases: [{
            key: 'xarth:0', label: 'Xarth', monsterId: 16684, version: '', defaults: specs(0, 2), parts: THIRD_RANGED,
          }],
        },
      ],
    },
    {
      id: 'ocellus',
      label: 'Ocellus',
      options: [{
        id: 'ocellus',
        name: 'Ocellus',
        phases: [
          {
            key: 'ocellus:0', label: 'Phase 1', monsterId: 16673, version: 'Phase 1', defaults: specs(0, 2), parts: HALF_RANGED,
          },
          {
            key: 'ocellus:1',
            label: 'The Blade',
            monsterId: 16675,
            version: 'Phase 2',
            defaults: specs(2, 4),
            allowedStyles: ['ranged'],
            // running to safe tiles between the blades leaves no time for 2-3 tick weapons
            state: { minAttackSpeed: 4 },
          },
          {
            key: 'ocellus:2',
            label: 'Phase 3',
            monsterId: 16677,
            version: 'Phase 3',
            defaults: specs(2, 0),
            // a fifth of it ranged, the rest any style
            parts: [{ styles: ['ranged'], share: 0.2 }, { share: 0.8 }],
          },
        ],
      }],
    },
  ],
  defaultRoute: { second: 'bork', third: 'dreadnoth', fourth: 'xarth' },
};

export default fracturedArchive;
