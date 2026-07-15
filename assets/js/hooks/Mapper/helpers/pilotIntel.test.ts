import { buildPilotIntelSnapshot, getIntelFreshness } from './pilotIntel';
import { MassState, TimeStatus } from '@/hooks/Mapper/types/connection';
import { SignatureGroup, SignatureKind } from '@/hooks/Mapper/types/signatures';

const NOW = new Date('2026-07-15T13:00:00Z').getTime();

const signature = (overrides: Record<string, unknown> = {}) => ({
  eve_id: 'ABC-123',
  kind: SignatureKind.CosmicSignature,
  name: '',
  group: SignatureGroup.CosmicSignature,
  type: 'Unknown',
  updated_at: '2026-07-15T12:50:00Z',
  ...overrides,
});

describe('pilot intel snapshot', () => {
  it('classifies scanner freshness without pretending missing data is fresh', () => {
    expect(getIntelFreshness(null)).toBe('unknown');
    expect(getIntelFreshness(10)).toBe('fresh');
    expect(getIntelFreshness(30)).toBe('aging');
    expect(getIntelFreshness(90)).toBe('stale');
  });

  it('summarizes actionable selected-system intel', () => {
    const result = buildPilotIntelSnapshot({
      systemId: '31000001',
      now: NOW,
      hasKillCoverage: true,
      signatures: [
        signature(),
        signature({
          eve_id: 'DEF-456',
          group: SignatureGroup.Wormhole,
          name: 'Unstable Wormhole',
          type: 'K162',
          updated_at: '2026-07-15T12:56:00Z',
        }),
      ],
      kills: [
        {
          killmail_id: 7,
          solar_system_id: 31000001,
          kill_time: '2026-07-15T12:40:00Z',
          attacker_count: 8,
        },
      ],
      connections: [
        {
          id: 'edge',
          source: '31000001',
          target: '31000002',
          time_status: TimeStatus._1h,
          mass_status: MassState.verge,
          ship_size_type: 2 as const,
          locked: false,
        },
      ],
      characters: [
        {
          eve_id: '99',
          name: 'Scout',
          online: true,
          location: { solar_system_id: 31000001, station_id: null, structure_id: null },
          ship: {
            ship_name: 'Eyes',
            ship_type_id: 111,
            ship_type_info: {
              capacity: '0',
              group_id: 25,
              group_name: 'Frigate',
              mass: '1000',
              name: 'Buzzard',
              type_id: 111,
              volume: '0',
            },
          },
          alliance_id: null,
          alliance_name: null,
          alliance_ticker: null,
          corporation_id: 1,
          corporation_name: 'Corp',
          corporation_ticker: 'CORP',
        },
      ],
    });

    expect(result.scanFreshness).toBe('fresh');
    expect(result.unresolvedSignatureCount).toBe(1);
    expect(result.unresolvedWormholeCount).toBe(1);
    expect(result.recentKillCount).toBe(1);
    expect(result.possibleGangKillCount).toBe(1);
    expect(result.criticalMassConnectionCount).toBe(1);
    expect(result.eolConnectionCount).toBe(1);
    expect(result.onlinePilotCount).toBe(1);
    expect(result.onlineShipTypes).toEqual(['Buzzard']);
    expect(result.risk).toBe('danger');
  });

  it('reports unknown when there is no trustworthy coverage', () => {
    const result = buildPilotIntelSnapshot({ systemId: '1', now: NOW });

    expect(result.risk).toBe('unknown');
    expect(result.scanFreshness).toBe('unknown');
    expect(result.hasKillCoverage).toBe(false);
  });
});

describe('pilot intel time boundaries', () => {
  it('uses exact minute boundaries for scan freshness', () => {
    const scanTime = '2026-07-15T12:00:00.000Z';
    const signatures = [signature({ updated_at: scanTime })];
    const at = (minutes: number) =>
      buildPilotIntelSnapshot({
        systemId: '1',
        signatures,
        now: new Date(scanTime).getTime() + minutes * 60_000,
      }).scanFreshness;

    expect(at(15)).toBe('fresh');
    expect(at(16)).toBe('aging');
    expect(at(45)).toBe('aging');
    expect(at(46)).toBe('stale');
  });

  it('includes a kill at exactly one hour and expires it immediately after the boundary', () => {
    const boundaryKill = {
      killmail_id: 10,
      solar_system_id: 1,
      kill_time: new Date(NOW - 60 * 60_000).toISOString(),
      attacker_count: 5,
    };
    const expiredKill = {
      killmail_id: 11,
      solar_system_id: 1,
      kill_time: new Date(NOW - 60 * 60_000 - 1).toISOString(),
      attacker_count: 9,
    };

    const atBoundary = buildPilotIntelSnapshot({
      systemId: '1',
      kills: [boundaryKill, expiredKill],
      hasKillCoverage: true,
      now: NOW,
    });
    expect(atBoundary.recentKillCount).toBe(1);
    expect(atBoundary.possibleGangKillCount).toBe(1);
    expect(atBoundary.riskReasons).toContain('1 kill in the last hour');
    expect(atBoundary.riskReasons).toContain('recent multi-attacker activity');
    expect(atBoundary.risk).toBe('danger');

    const afterBoundary = buildPilotIntelSnapshot({
      systemId: '1',
      kills: [boundaryKill, expiredKill],
      hasKillCoverage: true,
      now: NOW + 1,
    });
    expect(afterBoundary.recentKillCount).toBe(0);
    expect(afterBoundary.possibleGangKillCount).toBe(0);
    expect(afterBoundary.riskReasons).not.toContain('1 kill in the last hour');
    expect(afterBoundary.riskReasons).not.toContain('recent multi-attacker activity');
    expect(afterBoundary.risk).toBe('nominal');
  });
});
