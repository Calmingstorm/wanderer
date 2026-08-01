import { SignatureGroup, SignatureKind, SystemSignature } from '@/hooks/Mapper/types';
import { buildSignatureReconciliation, getSignatureScanProgress } from './signatureReconciliation';

const sig = (eve_id: string, group: SignatureGroup, name: string, linked = false): SystemSignature => ({
  eve_id,
  kind: SignatureKind.CosmicSignature,
  group,
  name,
  type: '',
  ...(linked ? { linked_system: { solar_system_id: 31_000_002, solar_system_name: 'J100002' } as SystemSignature['linked_system'] } : {}),
});

describe('signature reconciliation safety', () => {
  const existing = [sig('AAA-111', SignatureGroup.CosmicSignature, 'Unknown'), sig('BBB-222', SignatureGroup.Wormhole, 'Unstable Wormhole', true)];
  const incoming = [sig('AAA-111', SignatureGroup.RelicSite, 'Ruined Monument'), sig('CCC-333', SignatureGroup.GasSite, 'Barren Perimeter Reservoir')];

  it('uses update-only semantics by default and cannot delete a chain link', () => {
    const preview = buildSignatureReconciliation(existing, incoming, false);
    expect(preview.added.map(s => s.eve_id)).toEqual(['CCC-333']);
    expect(preview.changed.map(change => change.after.eve_id)).toEqual(['AAA-111']);
    expect(preview.removed).toEqual([]);
    expect(preview.affectedLinks).toEqual([]);
  });

  it('shows removals and affected links only for an explicit full sync', () => {
    const preview = buildSignatureReconciliation(existing, incoming, true);
    expect(preview.removed.map(s => s.eve_id)).toEqual(['BBB-222']);
    expect(preview.affectedLinks.map(s => s.eve_id)).toEqual(['BBB-222']);
  });

  it('calculates Pathfinder-style resolved group completion', () => {
    expect(getSignatureScanProgress(existing)).toEqual({ scanned: 1, total: 2, percent: 50 });
  });
});
