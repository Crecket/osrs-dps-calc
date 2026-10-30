import { getMonsters } from '@/lib/Monsters';
import { Monster } from '@/types/Monster';
import { prepareMonster } from '@/bulk/lib/compute';
import {
  DefenceCounts, RaidBoss, RaidDef, RaidPhase, Route, RoutePhase,
} from '@/raid/types';

/** One boss per stop: the route's choice, or the stop's first option when it is missing or unknown */
export const routeBosses = (raid: RaidDef, route: Route): RaidBoss[] => raid.stops.map(
  (stop) => stop.options.find((b) => b.id === route[stop.id]) ?? stop.options[0],
);

let monsters: Omit<Monster, 'inputs'>[] | null = null;
const findMonster = (id: number, version: string) => {
  if (!monsters) monsters = getMonsters();
  const m = monsters.find((x) => x.id === id && x.version === version);
  if (!m) throw new Error(`Unknown monster ${id} (${version})`);
  return m;
};

/** The boss's picture among the calculator's monster images: its first phase's monster's */
export const bossImage = (boss: RaidBoss): string | null => {
  const [first] = boss.phases;
  return first ? findMonster(first.monsterId, first.version).image ?? null : null;
};

/** The monster as the phase fights it: its share of the health and its state's armour */
const inState = <M extends Omit<Monster, 'inputs'>>(m: M, phase: RaidPhase): M => {
  const { hpShare, state } = phase;
  if (hpShare === undefined && !state) return m;
  const defensive = { ...m.defensive };
  if (state?.flatArmour !== undefined) defensive.flat_armour = state.flatArmour;
  if (state?.alwaysHit) {
    (Object.keys(defensive) as (keyof typeof defensive)[]).forEach((k) => {
      if (k !== 'flat_armour') defensive[k] = -64;
    });
  }
  return {
    ...m,
    skills: {
      ...m.skills,
      hp: hpShare === undefined ? m.skills.hp : Math.round(m.skills.hp * hpShare),
      def: state?.alwaysHit ? 0 : m.skills.def,
    },
    defensive,
  };
};

/**
 * Every phase on the route with its monster prepared for the fight: each phase's default specs overridden by
 * `counts[phase.key]`, or those of the phase it keeps the drain of. The specs lower Defence whatever the player carries,
 * as a teammate can do them.
 */
export const routePhases = (
  raid: RaidDef,
  route: Route,
  counts: Record<string, Partial<DefenceCounts>>,
): RoutePhase[] => routeBosses(raid, route).flatMap((boss) => boss.phases.map((phase): RoutePhase => {
  const source = boss.phases.find((p) => p.key === phase.defenceFrom) ?? phase;
  const merged = { ...source.defaults, ...counts[source.key] };
  const monster = prepareMonster(inState(findMonster(phase.monsterId, phase.version), phase), {
    defenceReductions: { elderMaul: merged.elderMaul, dwh: merged.dwh, tonalztic: merged.tonalztic },
  });
  return {
    boss, phase, counts: merged, monster: { id: phase.key, monster },
  };
}));
