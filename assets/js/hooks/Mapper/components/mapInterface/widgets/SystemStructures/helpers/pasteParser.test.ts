import { processSnippetText } from './pasteParser';

describe('structure clipboard parser current EVE d-scan TSV', () => {
  beforeEach(() => {
    let id = 0;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `structure-${++id}` });
  });

  it('parses representative four-column directional-scan structure rows', () => {
    const input = [
      '35832\tJ123456 - Home Astrahus\tAstrahus\t1,248 km',
      '35835\tJ123456 - Moon Athanor\tAthanor\t2.4 AU',
      '603\tStargate\tStargate\t8.2 AU',
    ].join('\r\n');

    expect(processSnippetText(input, [])).toEqual([
      expect.objectContaining({ structureTypeId: '35832', structureType: 'Astrahus', name: 'Home Astrahus', status: 'Powered' }),
      expect.objectContaining({ structureTypeId: '35835', structureType: 'Athanor', name: 'Moon Athanor', status: 'Powered' }),
    ]);
  });

  it('deduplicates repeated d-scan rows against stored structures', () => {
    const existing = [{ id: 'saved', structureTypeId: '35832', structureType: 'Astrahus', name: 'Home Astrahus', status: 'Powered' as const }];
    expect(processSnippetText('35832\tJ123456 - Home Astrahus\tAstrahus\t1,248 km', existing)).toEqual(existing);
  });
});
