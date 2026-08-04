import { CharacterTypeRaw, SolarSystemRawType } from '@/hooks/Mapper/types';
import { getSignaturePasteLocationWarning } from './signaturePasteGuard';

const makeSystem = (
  id: string,
  solarSystemId: number,
  canonicalName: string,
  alias: string | null = null,
): SolarSystemRawType =>
  ({
    id,
    name: alias,
    temporary_name: null,
    system_static_info: {
      solar_system_id: solarSystemId,
      solar_system_name: canonicalName,
    },
  }) as SolarSystemRawType;

const makeCharacter = (eveId: string, name: string, solarSystemId: number | null, online = true): CharacterTypeRaw =>
  ({
    eve_id: eveId,
    name,
    online,
    location: solarSystemId == null ? null : { solar_system_id: solarSystemId, station_id: null, structure_id: null },
  }) as CharacterTypeRaw;

const systems = [makeSystem('map-home', 31_000_001, 'J100001', 'Home'), makeSystem('map-chain', 31_000_002, 'J100002')];

const baseInput = {
  characters: [makeCharacter('main', 'Main Pilot', 31_000_001)],
  followingCharacterEveId: null,
  mainCharacterEveId: 'main',
  selectedMapSystemId: 'map-chain',
  systems,
  userCharacters: ['main'],
};

describe('getSignaturePasteLocationWarning', () => {
  it('warns when the selected system differs from the main character location', () => {
    expect(getSignaturePasteLocationWarning(baseInput)).toEqual({
      activeCharacterName: 'Main Pilot',
      currentMapSystemId: 'map-home',
      currentSystemName: 'Home (J100001)',
      currentSolarSystemId: 31_000_001,
      selectedMapSystemId: 'map-chain',
      selectedSystemName: 'J100002',
      selectedSolarSystemId: 31_000_002,
    });
  });

  it('does not warn when the selected system matches the character location', () => {
    expect(getSignaturePasteLocationWarning({ ...baseInput, selectedMapSystemId: 'map-home' })).toBeNull();
  });

  it('prefers the followed character over the main character', () => {
    const warning = getSignaturePasteLocationWarning({
      ...baseInput,
      characters: [makeCharacter('main', 'Main Pilot', 31_000_001), makeCharacter('followed', 'Scout', 31_000_002)],
      followingCharacterEveId: 'followed',
      userCharacters: ['main', 'followed'],
    });

    expect(warning).toBeNull();
  });

  it('falls back to one online own character when no preferred character is usable', () => {
    const warning = getSignaturePasteLocationWarning({
      ...baseInput,
      characters: [makeCharacter('only', 'Only Pilot', 31_000_001)],
      mainCharacterEveId: null,
      userCharacters: ['only'],
    });

    expect(warning?.activeCharacterName).toBe('Only Pilot');
  });

  it('does not guess when multiple online own characters have different possible locations', () => {
    expect(
      getSignaturePasteLocationWarning({
        ...baseInput,
        characters: [makeCharacter('one', 'One', 31_000_001), makeCharacter('two', 'Two', 31_000_002)],
        mainCharacterEveId: null,
        userCharacters: ['one', 'two'],
      }),
    ).toBeNull();
  });

  it('ignores offline and non-owned preferred characters', () => {
    expect(
      getSignaturePasteLocationWarning({
        ...baseInput,
        characters: [makeCharacter('main', 'Main Pilot', 31_000_001, false)],
      }),
    ).toBeNull();

    expect(getSignaturePasteLocationWarning({ ...baseInput, userCharacters: [] })).toBeNull();
  });

  it('does not throw while selected-system static data is still hydrating', () => {
    const partialSystem = {
      id: 'map-hydrating',
      name: null,
      temporary_name: null,
    } as SolarSystemRawType;

    expect(
      getSignaturePasteLocationWarning({
        ...baseInput,
        selectedMapSystemId: partialSystem.id,
        systems: [...systems, partialSystem],
      }),
    ).toBeNull();
  });

  it('ignores other partially hydrated systems when finding the character location', () => {
    const partialSystem = {
      id: 'map-hydrating',
      name: null,
      temporary_name: null,
    } as SolarSystemRawType;

    expect(
      getSignaturePasteLocationWarning({
        ...baseInput,
        systems: [partialSystem, ...systems],
      })?.currentSystemName,
    ).toBe('Home (J100001)');
  });

  it('does not warn when location or selected-system data is unavailable', () => {
    expect(
      getSignaturePasteLocationWarning({
        ...baseInput,
        characters: [makeCharacter('main', 'Main Pilot', null)],
      }),
    ).toBeNull();
    expect(getSignaturePasteLocationWarning({ ...baseInput, selectedMapSystemId: undefined })).toBeNull();
  });
});
