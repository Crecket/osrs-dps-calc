import { describe, expect, test } from '@jest/globals';
import { EquipmentPiece } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { computeRow, prepareMonster } from '@/bulk/lib/compute';
import {
  bestPool, GearSlot, styleScore, WeaponJob, weaponJobs,
} from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  activeEffects, activeSets, baselineGear, buildPlayer, effectCandidates, effectMatters, evalDps, Gear, linkedEffects, plainTwin,
  searchWeapon, styleEffects,
} from '@/best/lib/search';
import {
  BEST_STYLES, BestInputs, BestStyle, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { findEquipment, getTestMonster } from '@/tests/utils/TestUtils';

const pool = bestPool();

const skills99 = {
  atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
};

const inputs: BestInputs = {
  skills: skills99,
  unlocks: DEFAULT_UNLOCKS,
  conditions: DEFAULT_CONDITIONS,
  potions: {},
  styles: BEST_STYLES,
  topN: 5,
};

const monster = (name: string, version = ''): Monster => prepareMonster(getTestMonster(name, version));
const vorkath = monster('Vorkath', 'Post-quest');
const abyssal = monster('Abyssal demon', 'Standard');

const jobFor = (style: BestStyle, weapon: string, version: string, stance: string, extra: (j: WeaponJob) => boolean = () => true) => {
  const id = findEquipment(weapon, version).id;
  const job = weaponJobs(pool, style).find((j) => j.weaponId === id && j.combatStyle.name === stance && extra(j));
  if (!job) throw new Error(`no job for ${weapon} ${stance}`);
  return job;
};

const scytheJob = jobFor('slash', 'Scythe of Vitur', 'Charged', 'Chop');
// the pool holds the canonical version of an item
const poolItem = (name: string) => pool.find((e) => e.name === name)!;
const salveEi = poolItem('Salve amulet(ei)');
// for melee the (e) and (ei) salves are the same item
const meleeSalves = [poolItem('Salve amulet (e)').id, salveEi.id];
const ids = (items: EquipmentPiece[] | undefined) => (items ?? []).map((e) => e.id);

describe('buildPlayer and evalDps', () => {
  test('evalDps matches computeRow for the same player', () => {
    const base = basePlayer(inputs, 'slash');
    const gear: Gear = {
      head: findEquipment('Torva full helm', 'Restored').id,
      body: findEquipment('Torva platebody', 'Restored').id,
      legs: findEquipment('Torva platelegs', 'Restored').id,
      neck: findEquipment('Amulet of rancour').id,
      ring: findEquipment('Ultor ring').id,
    };
    [vorkath, abyssal, monster('Vardorvis', 'Post-quest')].forEach((m) => {
      const row = computeRow({ id: 's', name: 's', player: buildPlayer(base, scytheJob, gear) }, { id: 'm', monster: m });
      expect(row.dps).toBeGreaterThan(0);
      expect(evalDps(base, m, scytheJob, gear)).toBeCloseTo(row.dps, 10);
    });
  });

  test('a two-handed weapon empties the shield', () => {
    const base = basePlayer(inputs, 'slash');
    const player = buildPlayer(base, scytheJob, { shield: findEquipment('Avernic defender', 'Normal').id });
    expect(player.equipment.shield).toBeNull();
    expect(player.equipment.weapon?.id).toBe(scytheJob.weaponId);
    expect(player.style).toEqual(scytheJob.combatStyle);
  });

  test('spell, blowpipe dart and fixed ammo jobs match computeRow', () => {
    const kodai = jobFor('magic', 'Kodai wand', '', 'Spell', (j) => j.spellName === 'Ice Barrage');
    const blowpipe = jobFor('ranged', 'Toxic blowpipe', 'Charged', 'Rapid', (j) => j.dartId !== null
      && pool.find((e) => e.id === j.dartId)!.name === 'Dragon dart');
    const acb = jobFor('ranged', 'Armadyl crossbow', '', 'Rapid', (j) => j.ammoId === poolItem('Ruby dragon bolts (e)').id);
    const cases: [WeaponJob, BestStyle, (p: ReturnType<typeof buildPlayer>) => void][] = [
      [kodai, 'magic', (p) => expect(p.spell?.name).toBe('Ice Barrage')],
      [blowpipe, 'ranged', (p) => expect(p.equipment.weapon?.itemVars).toEqual({ blowpipeDartId: blowpipe.dartId, blowpipeDartName: 'Dragon dart' })],
      [acb, 'ranged', (p) => expect(p.equipment.ammo?.id).toBe(acb.ammoId)],
    ];
    const blessing = poolItem("Rada's blessing 4").id;
    cases.forEach(([job, style, check]) => {
      const base = basePlayer(inputs, style);
      // the job's ammo wins over gear.ammo
      const player = buildPlayer(base, job, { ammo: blessing });
      check(player);
      const row = computeRow({ id: 's', name: 's', player }, { id: 'm', monster: vorkath });
      expect(row.dps).toBeGreaterThan(0);
      expect(evalDps(base, vorkath, job, { ammo: blessing })).toBeCloseTo(row.dps, 10);
    });
  });

  test('evalDps returns 0 instead of throwing', () => {
    const base = basePlayer(inputs, 'slash');
    expect(evalDps(base, { ...vorkath, skills: undefined } as unknown as Monster, scytheJob, {})).toBe(0);
  });
});

describe('plainTwin', () => {
  test('keeps the stats but loses the effect', () => {
    const twin = plainTwin(salveEi);
    expect(twin.id).toBe(-1000000 - salveEi.id);
    expect(twin.name).toBe(`__plain ${salveEi.id}`);
    expect(twin.offensive).toEqual(salveEi.offensive);
    expect(twin.bonuses).toEqual(salveEi.bonuses);

    const base = basePlayer(inputs, 'slash');
    const withNeck = (id: number) => ({ ...baselineGear(pool, scytheJob), neck: id });
    expect(evalDps(base, vorkath, scytheJob, withNeck(twin.id))).toBeLessThan(evalDps(base, vorkath, scytheJob, withNeck(salveEi.id)));
    expect(evalDps(base, abyssal, scytheJob, withNeck(twin.id))).toBe(evalDps(base, abyssal, scytheJob, withNeck(salveEi.id)));
  });
});

describe('activity test', () => {
  test('an effect matters when it raises or lowers DPS beyond float noise', () => {
    expect(effectMatters(10, 9)).toBe(true);
    // an effect that lowers DPS stays an effect candidate: as a plain item it could prune items that beat it
    expect(effectMatters(9, 10)).toBe(true);
    expect(effectMatters(10, 10 + 1e-12)).toBe(false);
  });

  test('salve is only active against undead', () => {
    const base = basePlayer(inputs, 'slash');
    const baseline = baselineGear(pool, scytheJob);
    const effect = effectCandidates(pool, 'slash');
    expect(ids(activeEffects(base, abyssal, scytheJob, baseline, effect).neck)).not.toContain(salveEi.id);
    expect(ids(activeEffects(base, vorkath, scytheJob, baseline, effect).neck)).toContain(salveEi.id);
  });

  test('the inquisitor set is active with the inquisitor mace on crush', () => {
    const base = basePlayer(inputs, 'crush');
    const job = jobFor('crush', "Inquisitor's mace", '', 'Pound');
    const sets = activeSets(base, monster('General Graardor'), job, baselineGear(pool, job), pool);
    const inquisitor = sets.find((s) => s.name === 'Inquisitor');
    expect(inquisitor).toBeDefined();
    expect(Object.values(inquisitor!.pieces).map((p) => p!.name).sort())
      .toEqual(["Inquisitor's great helm", "Inquisitor's hauberk", "Inquisitor's plateskirt"]);
  });
});

describe('searchWeapon', () => {
  test('exhaustive Scythe vs Vorkath: top 3 by DPS, a salve (e)/(ei) in the neck', () => {
    const base = basePlayer(inputs, 'slash');
    const results = searchWeapon(base, vorkath, scytheJob, pool, { mode: 'exhaustive', topN: 3, cap: 20000 });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.dps)).toEqual([...results.map((r) => r.dps)].sort((a, b) => b - a));
    expect(meleeSalves).toContain(results[0].gear.neck);
    expect(results[0].approximate).toBe(false);
    expect(results[0].dps).toBeCloseTo(evalDps(base, vorkath, scytheJob, results[0].gear), 10);
  });

  test('on a slayer task an imbued slayer helmet goes on the head', () => {
    const base = basePlayer({ ...inputs, conditions: { ...DEFAULT_CONDITIONS, onSlayerTask: true } }, 'slash');
    const [best] = searchWeapon(base, abyssal, scytheJob, pool, { mode: 'exhaustive', topN: 1, cap: 20000 });
    // V's helm is a Slayer helmet (i) with better bonuses
    expect([poolItem('Slayer helmet (i)').id, poolItem("V's helm").id]).toContain(best.gear.head);
  });

  test('a one-handed weapon gets a shield at least as good as the Avernic defender', () => {
    const base = basePlayer(inputs, 'stab');
    const job = jobFor('stab', 'Ghrazi rapier', '', 'Lunge');
    const [best] = searchWeapon(base, abyssal, job, pool, { mode: 'exhaustive', topN: 1, cap: 20000 });
    expect(best.gear.shield).not.toBeNull();
    const shield = pool.find((e) => e.id === best.gear.shield)!;
    const avernic = styleScore(findEquipment('Avernic defender', 'Normal'), 'stab');
    const score = styleScore(shield, 'stab');
    expect(score[0] + score[1]).toBeGreaterThanOrEqual(avernic[0] + avernic[1]);
  });

  test('over the cap the exhaustive search falls back to descent and says so', () => {
    const base = basePlayer(inputs, 'slash');
    const [best] = searchWeapon(base, vorkath, scytheJob, pool, { mode: 'exhaustive', topN: 1, cap: 10 });
    expect(best.approximate).toBe(true);
    expect(meleeSalves).toContain(best.gear.neck);
  });

  test('descent with style-wide effects still finds the salve', () => {
    const base = basePlayer(inputs, 'slash');
    const effects = styleEffects(base, vorkath, scytheJob, pool);
    expect(ids(effects.neck)).toContain(salveEi.id);
    const [best] = searchWeapon(base, vorkath, scytheJob, pool, {
      mode: 'descent', topN: 1, cap: 20000, effects,
    });
    expect(meleeSalves).toContain(best.gear.neck);
  });

  test('weapon-linked effects are tested per job even with style-wide effects', () => {
    const base = basePlayer(inputs, 'crush');
    const target = monster('General Graardor');
    const reference = jobFor('crush', "Inquisitor's mace", '', 'Pound');
    const effects = styleEffects(base, target, reference, pool);
    const berserker = poolItem('Berserker necklace');
    expect(ids(effects.neck)).not.toContain(berserker.id);

    const job = jobFor('crush', 'Tzhaar-ket-om', '', 'Pound');
    // the Amulet of rancour beats the necklace here, so leave it out
    const noRancour = pool.filter((e) => !e.name.startsWith('Amulet of rancour'));
    const [best] = searchWeapon(base, target, job, noRancour, {
      mode: 'descent', topN: 1, cap: 20000, effects,
    });
    expect(best.gear.neck).toBe(berserker.id);
    const [noBerserker] = searchWeapon(base, target, job, noRancour.filter((e) => !e.name.startsWith('Berserker necklace')), {
      mode: 'descent', topN: 1, cap: 20000, effects,
    });
    expect(best.dps).toBeGreaterThan(noBerserker.dps);
  });

  // the linked item is re-tested for the matching job, and is active there
  const linkedAndActive = (style: BestStyle, target: Monster, job: WeaponJob, item: EquipmentPiece) => {
    const base = basePlayer(inputs, style);
    const linked = linkedEffects(pool, job);
    const active = activeEffects(base, target, job, baselineGear(pool, job), linked);
    return [ids(linked[item.slot as GearSlot]).includes(item.id), ids(active[item.slot as GearSlot]).includes(item.id)];
  };

  test("Efaritay's aid is linked to silver weapons", () => {
    const juvinate = monster('Vampyre Juvinate', 'Level 54 (Darkmeyer)');
    const efaritay = poolItem("Efaritay's aid");
    const flail = jobFor('crush', 'Blisterwood flail', '', 'Pound');
    expect(linkedAndActive('crush', juvinate, flail, efaritay)).toEqual([true, true]);
    expect(ids(linkedEffects(pool, jobFor('crush', 'Dragon mace', '', 'Pound')).ring)).not.toContain(efaritay.id);
  });

  test('Chaos gauntlets are linked to Bolt spells', () => {
    const gauntlets = poolItem('Chaos gauntlets');
    const twinflame = (spell: string) => jobFor('magic', 'Twinflame staff', '', 'Spell', (j) => j.spellName === spell);
    expect(linkedAndActive('magic', vorkath, twinflame('Fire Bolt'), gauntlets)).toEqual([true, true]);
    expect(ids(linkedEffects(pool, twinflame('Fire Surge')).hands)).not.toContain(gauntlets.id);
  });

  test('ranged weapons that fire no ammo leave the ammo slot empty', () => {
    const base = basePlayer(inputs, 'ranged');
    const bofa = jobFor('ranged', 'Bow of Faerdhinen', 'Charged', 'Rapid');
    const blowpipe = weaponJobs(pool, 'ranged').find((j) => j.dartId !== null && j.combatStyle.name === 'Rapid')!;
    [bofa, blowpipe].forEach((job) => {
      expect(baselineGear(pool, job).ammo).toBeNull();
      const results = searchWeapon(base, vorkath, job, pool, { mode: 'exhaustive', topN: 3, cap: 20000 });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => expect(r.gear.ammo).toBeNull());
    });
  });

  test('the Eclipse atlatl, which hits with melee strength, gets melee strength gear', () => {
    const base = basePlayer(inputs, 'ranged');
    const job = jobFor('ranged', 'Eclipse atlatl', '', 'Rapid');
    const [best] = searchWeapon(base, abyssal, job, pool, { mode: 'exhaustive', topN: 1, cap: 20000 });
    // a hand-picked melee strength setup: what the search finds must be at least as good
    const hand: Gear = {
      ...best.gear,
      head: poolItem('Torva full helm').id,
      body: poolItem('Torva platebody').id,
      legs: poolItem('Torva platelegs').id,
      neck: poolItem('Amulet of rancour').id,
      hands: poolItem('Ferocious gloves').id,
      ring: poolItem('Ultor ring').id,
    };
    expect(best.dps).toBeGreaterThanOrEqual(evalDps(base, abyssal, job, hand));
  });

  test('topN 0 returns nothing', () => {
    const base = basePlayer(inputs, 'slash');
    expect(searchWeapon(base, vorkath, scytheJob, pool, {
      mode: 'descent', topN: 0, cap: 1, effects: {},
    })).toEqual([]);
  });

  test('descent with no effects still tests the Blood Moon set with the Dual macuahuitl', () => {
    const base = basePlayer(inputs, 'crush');
    const job = jobFor('crush', 'Dual macuahuitl', '', 'Pound');
    // low crush defence: the set's extra hits outweigh the bonuses of the best plain armour
    const target = abyssal;
    const opts = {
      mode: 'descent' as const, topN: 1, cap: 20000, effects: {},
    };
    const bloodMoon = (e: EquipmentPiece) => e.name.startsWith('Blood Moon ');
    const [best] = searchWeapon(base, target, job, pool, opts);
    const [noSet] = searchWeapon(base, target, job, pool.filter((e) => !bloodMoon(e)), opts);
    const setPieces = (['head', 'body', 'legs'] as GearSlot[]).reduce<Gear>((gear, slot) => ({
      ...gear, [slot]: pool.find((e) => bloodMoon(e) && e.slot === slot && e.version === 'New')!.id,
    }), {});
    const withSet = evalDps(base, target, job, { ...noSet.gear, ...setPieces });

    const wearsSet = (['head', 'body', 'legs'] as GearSlot[]).every((slot) => bloodMoon(pool.find((e) => e.id === best.gear[slot])!));
    expect(withSet).toBeGreaterThan(noSet.dps);
    expect(wearsSet).toBe(true);
    expect(best.dps).toBeGreaterThanOrEqual(withSet - 1e-9);
  });

  test('the Twisted bow vs Vorkath fires dragon arrows, not minigame ammo', () => {
    const base = basePlayer(inputs, 'ranged');
    const tbow = findEquipment('Twisted bow').id;
    const jobs = weaponJobs(pool, 'ranged').filter((j) => j.weaponId === tbow && j.combatStyle.name === 'Rapid');
    const results = jobs.flatMap((job) => searchWeapon(base, vorkath, job, pool, {
      mode: 'descent', topN: 1, cap: 20000, effects: {},
    }));
    const best = results.reduce((a, b) => (b.dps > a.dps ? b : a));
    const ammo = pool.find((e) => e.id === best.job.ammoId)!;
    // the Seeking dragon arrow (+20 ranged attack) is a real arrow too
    expect(ammo.name).toMatch(/dragon arrow/i);
  });
});
