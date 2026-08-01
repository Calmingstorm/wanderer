import { parseSignatures, UNKNOWN_SIGNATURE_NAME } from './parseSignatures';
import { SignatureGroup, SignatureKind } from '@/hooks/Mapper/types';

const availableKinds = Object.values(SignatureKind);

describe('parseSignatures current EVE probe-scanner TSV', () => {
  it('parses representative resolved and unresolved scanner rows and ignores unrelated clipboard rows', () => {
    const input = [
      'ABC-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t4.21 AU',
      'DEF-456\tCosmic Signature\tRelic Site\tRuined Serpentis Monument Site\t100.0%\t12.4 AU',
      'GHI-789\tCosmic Signature\t\t\t32.5%\t7.50 AU',
      'not a scanner row',
    ].join('\r\n');

    expect(parseSignatures(input, availableKinds)).toEqual([
      expect.objectContaining({ eve_id: 'ABC-123', kind: SignatureKind.CosmicSignature, group: SignatureGroup.Wormhole, name: 'Unstable Wormhole' }),
      expect.objectContaining({ eve_id: 'DEF-456', kind: SignatureKind.CosmicSignature, group: SignatureGroup.RelicSite, name: 'Ruined Serpentis Monument Site' }),
      expect.objectContaining({ eve_id: 'GHI-789', kind: SignatureKind.CosmicSignature, group: SignatureGroup.CosmicSignature, name: UNKNOWN_SIGNATURE_NAME }),
    ]);
  });

  it('rejects malformed signature ids and rows missing EVE scanner columns', () => {
    expect(parseSignatures('AB-123\tCosmic Signature\tWormhole\tUnstable Wormhole\t100.0%\t1 AU\nABC-123\tCosmic Signature', availableKinds)).toEqual([]);
  });
});
