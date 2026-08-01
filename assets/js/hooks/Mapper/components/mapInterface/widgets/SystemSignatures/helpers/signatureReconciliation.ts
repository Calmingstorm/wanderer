import { SignatureGroup, SignatureKind, SystemSignature } from '@/hooks/Mapper/types';
import { getActualSigs } from './getActualSigs';

export interface SignatureChange {
  before: SystemSignature;
  after: SystemSignature;
}

export interface SignatureReconciliation {
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

const fingerprintSignature = (signature: SystemSignature) => ({
  eve_id: signature.eve_id,
  group: signature.group,
  kind: signature.kind,
  name: signature.name,
  type: signature.type,
  description: signature.description,
  custom_info: signature.custom_info,
  linked_system_id: signature.linked_system?.solar_system_id,
  deleted: signature.deleted,
  updated_at: signature.updated_at,
});

export const getSignatureStateFingerprint = (signatures: SystemSignature[]): string =>
  JSON.stringify(
    signatures
      .map(fingerprintSignature)
      .sort((left, right) => left.eve_id.localeCompare(right.eve_id)),
  );

/**
 * Build the exact mutation set that a scanner paste would send to the server.
 * Full sync is intentionally explicit: partial/update-only pastes never infer removals.
 */
export const buildSignatureReconciliation = (
  existing: SystemSignature[],
  incoming: SystemSignature[],
  fullSync: boolean,
): SignatureReconciliation => {
  const { added, updated, removed } = getActualSigs(existing, incoming, !fullSync, true);
  const existingById = new Map(existing.map(signature => [signature.eve_id, signature]));
  const changed = updated.flatMap(after => {
    const before = existingById.get(after.eve_id);
    return before ? [{ before, after }] : [];
  });

  return {
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
