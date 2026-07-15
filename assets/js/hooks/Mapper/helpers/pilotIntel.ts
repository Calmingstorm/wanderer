import { CharacterTypeRaw, SolarSystemConnection, SystemSignature } from '@/hooks/Mapper/types';
import { DetailedKill } from '@/hooks/Mapper/types/kills';
import { MassState, TimeStatus } from '@/hooks/Mapper/types/connection';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type IntelFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';
export type IntelRisk = 'danger' | 'caution' | 'watch' | 'nominal' | 'unknown';

export interface PilotIntelSnapshot {
  signatureCount: number;
  identifiedSignatureCount: number;
  unresolvedSignatureCount: number;
  unresolvedWormholeCount: number;
  scanUpdatedAt: string | null;
  scanAgeMinutes: number | null;
  scanFreshness: IntelFreshness;
  recentKillCount: number;
  latestKillAt: string | null;
  possibleGangKillCount: number;
  connectionCount: number;
  eolConnectionCount: number;
  criticalMassConnectionCount: number;
  reducedMassConnectionCount: number;
  onlinePilotCount: number;
  onlineShipTypes: string[];
  risk: IntelRisk;
  riskReasons: string[];
  hasKillCoverage: boolean;
}

interface BuildPilotIntelSnapshotInput {
  systemId: string | number;
  signatures?: SystemSignature[];
  kills?: DetailedKill[];
  connections?: SolarSystemConnection[];
  characters?: CharacterTypeRaw[];
  manualStatus?: number;
  hasKillCoverage?: boolean;
  now?: number;
}

function latestTimestamp(values: Array<string | undefined>): string | null {
  const latest = values.reduce<number | null>((result, value) => {
    if (!value) return result;
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) return result;
    return result == null || parsed > result ? parsed : result;
  }, null);

  return latest == null ? null : new Date(latest).toISOString();
}

export function getIntelFreshness(ageMinutes: number | null): IntelFreshness {
  if (ageMinutes == null) return 'unknown';
  if (ageMinutes <= 15) return 'fresh';
  if (ageMinutes <= 45) return 'aging';
  return 'stale';
}

export function buildPilotIntelSnapshot({
  systemId,
  signatures = [],
  kills = [],
  connections = [],
  characters = [],
  manualStatus = 0,
  hasKillCoverage = false,
  now = Date.now(),
}: BuildPilotIntelSnapshotInput): PilotIntelSnapshot {
  const normalizedSystemId = String(systemId);
  const scanUpdatedAt = latestTimestamp(signatures.map(signature => signature.updated_at ?? signature.inserted_at));
  const scanAgeMinutes =
    scanUpdatedAt == null ? null : Math.max(0, Math.floor((now - new Date(scanUpdatedAt).getTime()) / MINUTE));

  const relevantKills = kills.filter(kill => String(kill.solar_system_id) === normalizedSystemId);
  const recentKills = relevantKills.filter(kill => {
    if (!kill.kill_time) return false;
    const timestamp = new Date(kill.kill_time).getTime();
    return Number.isFinite(timestamp) && timestamp >= now - HOUR;
  });
  const latestKillAt = latestTimestamp(relevantKills.map(kill => kill.kill_time));

  const relevantConnections = connections.filter(
    connection => String(connection.source) === normalizedSystemId || String(connection.target) === normalizedSystemId,
  );
  const onlinePilots = characters.filter(
    character => character.online && String(character.location?.solar_system_id) === normalizedSystemId,
  );

  const unresolvedSignatures = signatures.filter(signature => signature.group === 'Cosmic Signature');
  const unresolvedWormholes = signatures.filter(
    signature => signature.group === 'Wormhole' && !signature.linked_system,
  );
  const eolConnections = relevantConnections.filter(connection => connection.time_status === TimeStatus._1h);
  const criticalMassConnections = relevantConnections.filter(connection => connection.mass_status === MassState.verge);
  const reducedMassConnections = relevantConnections.filter(connection => connection.mass_status === MassState.half);
  const possibleGangKills = recentKills.filter(kill => (kill.attacker_count ?? 0) >= 5);

  const riskReasons: string[] = [];
  let risk: IntelRisk = 'unknown';

  if (manualStatus === 6) riskReasons.push('manually marked dangerous');
  if (manualStatus === 5) riskReasons.push('manually marked target');
  if (manualStatus === 4) riskReasons.push('manual warning active');
  if (recentKills.length > 0)
    riskReasons.push(`${recentKills.length} kill${recentKills.length === 1 ? '' : 's'} in the last hour`);
  if (possibleGangKills.length > 0) riskReasons.push('recent multi-attacker activity');
  if (criticalMassConnections.length > 0) riskReasons.push('critical-mass connection');
  if (eolConnections.length > 0) riskReasons.push('end-of-life connection');
  if (onlinePilots.length > 0)
    riskReasons.push(`${onlinePilots.length} tracked pilot${onlinePilots.length === 1 ? '' : 's'} present`);
  if (unresolvedWormholes.length > 0)
    riskReasons.push(`${unresolvedWormholes.length} unresolved wormhole${unresolvedWormholes.length === 1 ? '' : 's'}`);

  if (manualStatus === 6 || recentKills.length > 0 || possibleGangKills.length > 0) {
    risk = 'danger';
  } else if (
    manualStatus === 4 ||
    manualStatus === 5 ||
    criticalMassConnections.length > 0 ||
    eolConnections.length > 0
  ) {
    risk = 'caution';
  } else if (onlinePilots.length > 0 || unresolvedWormholes.length > 0 || manualStatus === 3) {
    risk = 'watch';
  } else if (hasKillCoverage || signatures.length > 0 || relevantConnections.length > 0) {
    risk = 'nominal';
  }

  return {
    signatureCount: signatures.length,
    identifiedSignatureCount: signatures.length - unresolvedSignatures.length,
    unresolvedSignatureCount: unresolvedSignatures.length,
    unresolvedWormholeCount: unresolvedWormholes.length,
    scanUpdatedAt,
    scanAgeMinutes,
    scanFreshness: getIntelFreshness(scanAgeMinutes),
    recentKillCount: recentKills.length,
    latestKillAt,
    possibleGangKillCount: possibleGangKills.length,
    connectionCount: relevantConnections.length,
    eolConnectionCount: eolConnections.length,
    criticalMassConnectionCount: criticalMassConnections.length,
    reducedMassConnectionCount: reducedMassConnections.length,
    onlinePilotCount: onlinePilots.length,
    onlineShipTypes: Array.from(
      new Set(
        onlinePilots.map(character => character.ship?.ship_type_info?.name).filter((name): name is string => !!name),
      ),
    ).sort(),
    risk,
    riskReasons,
    hasKillCoverage,
  };
}
