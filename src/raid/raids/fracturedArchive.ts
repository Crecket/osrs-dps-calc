import { DefenceCounts, RaidDef } from '@/raid/types';

// Defence reduction defaults: the community's optimal specs per boss (Ralos counts hitsplats, as the engine does)
const specs = (elderMaul: number, tonalztic: number): DefenceCounts => ({ elderMaul, dwh: 0, tonalztic });

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
            key: 'guardian:0', label: 'Flying', monsterId: 16659, version: 'Flying', defaults: specs(0, 4),
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
          phases: [{
            key: 'bork:0', label: 'Bork', monsterId: 16640, version: '', defaults: specs(2, 0),
          }],
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
            key: 'dreadnoth:0', label: 'Dreadnoth', monsterId: 16665, version: '', defaults: specs(0, 5),
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
            key: 'xarth:0', label: 'Xarth', monsterId: 16684, version: '', defaults: specs(0, 2),
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
            key: 'ocellus:0', label: 'Phase 1', monsterId: 16673, version: 'Phase 1', defaults: specs(0, 2),
          },
          {
            key: 'ocellus:1', label: 'The Blade', monsterId: 16675, version: 'Phase 2', defaults: specs(2, 4),
          },
          {
            key: 'ocellus:2', label: 'Phase 3', monsterId: 16677, version: 'Phase 3', defaults: specs(2, 0),
          },
        ],
      }],
    },
  ],
  defaultRoute: { second: 'bork', third: 'dreadnoth', fourth: 'xarth' },
};

export default fracturedArchive;
