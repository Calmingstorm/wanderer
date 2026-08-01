import { SignatureGroup, SignatureKind, SystemSignature } from '@/hooks/Mapper/types';
import { getActualSigs } from './getActualSigs';

export interface SignatureChange {
  before: SystemSignature;
  after: SystemSignature;
}

export interface CanonicalSignatureSnapshot {
  eve_id: string;
  group: SignatureGroup;
  kind: SignatureKind;
  name: string;
  type: string;
  description: string | null;
  custom_info: unknown;
  temporary_name: string | null;
  character_eve_id: string | null;
  linked_system_id: number | null;
  deleted: boolean;
}

export interface SignatureReconciliation {
  systemId: string;
  baseSignaturesRaw: SystemSignature[];
  baseSignatures: CanonicalSignatureSnapshot[];
  incoming: SystemSignature[];
  added: SystemSignature[];
  changed: SignatureChange[];
  removed: SystemSignature[];
  affectedLinks: SystemSignature[];
  fullSync: boolean;
  baseFingerprint: string;
}

export interface SignatureScanProgress {
  scanned: number;
  total: number;
  percent: number;
}

const canonicalCustomInfo = (customInfo?: string): unknown => {
  if (!customInfo) return null;
  try {
    return JSON.parse(customInfo);
  } catch {
    return customInfo;
  }
};

const canonicalSignature = (signature: SystemSignature): CanonicalSignatureSnapshot => ({
  eve_id: signature.eve_id,
  group: signature.group,
  kind: signature.kind,
  name: signature.name,
  type: signature.type,
  description: signature.description ?? null,
  custom_info: canonicalCustomInfo(signature.custom_info),
  temporary_name: signature.temporary_name ?? null,
  character_eve_id: signature.character_eve_id ?? null,
  linked_system_id: signature.linked_system?.solar_system_id ?? null,
  deleted: !!signature.deleted,
});

export const getCanonicalSignatureSnapshot = (signatures: SystemSignature[]): CanonicalSignatureSnapshot[] =>
  signatures
    .map(canonicalSignature)
    .sort((left, right) => left.eve_id.localeCompare(right.eve_id));

export const getSignatureStateFingerprint = (signatures: SystemSignature[]): string =>
  JSON.stringify(getCanonicalSignatureSnapshot(signatures));

/**
 * Build the exact mutation set that a scanner paste would send to the server.
 * Full sync is intentionally explicit: partial/update-only pastes never infer removals.
 */
export const buildSignatureReconciliation = (
  existing: SystemSignature[],
  incoming: SystemSignature[],
  fullSync: boolean,
  systemId: string,
): SignatureReconciliation => {
  const { added, updated, removed } = getActualSigs(existing, incoming, !fullSync, true);
  const existingById = new Map(existing.map(signature => [signature.eve_id, signature]));
  const changed = updated.flatMap(after => {
    const before = existingById.get(after.eve_id);
    return before ? [{ before, after }] : [];
  });

  return {
    systemId,
    baseSignaturesRaw: existing.map(signature => ({ ...signature })),
    baseSignatures: getCanonicalSignatureSnapshot(existing),
    incoming,
    added,
    changed,
    removed,
    affectedLinks: removed.filter(signature => signature.linked_system != null),
    fullSync,
    baseFingerprint: getSignatureStateFingerprint(existing),
  };
};

/** Pathfinder-compatible completion: a cosmic signature is scanned once its group is known. */
export const getSignatureScanProgress = (signatures: SystemSignature[]): SignatureScanProgress => {
  const activeCosmicSignatures = signatures.filter(
    signature => !signature.deleted && signature.kind === SignatureKind.CosmicSignature,
  );
  const scanned = activeCosmicSignatures.filter(
    signature => signature.group != null && signature.group !== SignatureGroup.CosmicSignature,
  ).length;
  const total = activeCosmicSignatures.length;

  return {
    scanned,
    total,
    percent: total === 0 ? 0 : Math.round((scanned / total) * 100),
  };
};
