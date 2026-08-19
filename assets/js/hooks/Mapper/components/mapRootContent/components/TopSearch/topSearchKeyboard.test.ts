import { clampSearchIndex, getSearchKeyboardAction } from './topSearchKeyboard';

describe('top search keyboard navigation', () => {
  it('clamps indexes to the available results', () => {
    expect(clampSearchIndex(-2, 3)).toBe(0);
    expect(clampSearchIndex(8, 3)).toBe(2);
    expect(clampSearchIndex(0, 0)).toBe(-1);
  });

  it('moves through results without wrapping past either edge', () => {
    expect(getSearchKeyboardAction({ key: 'ArrowDown', activeIndex: -1, itemCount: 3 })).toEqual({
      type: 'move',
      index: 0,
    });
    expect(getSearchKeyboardAction({ key: 'ArrowDown', activeIndex: 2, itemCount: 3 })).toEqual({
      type: 'move',
      index: 2,
    });
    expect(getSearchKeyboardAction({ key: 'ArrowUp', activeIndex: -1, itemCount: 3 })).toEqual({
      type: 'move',
      index: 2,
    });
    expect(getSearchKeyboardAction({ key: 'ArrowUp', activeIndex: 0, itemCount: 3 })).toEqual({
      type: 'move',
      index: 0,
    });
  });

  it('does not try to move or select when there are no results', () => {
    expect(getSearchKeyboardAction({ key: 'ArrowDown', activeIndex: -1, itemCount: 0 })).toEqual({ type: 'none' });
    expect(getSearchKeyboardAction({ key: 'Home', activeIndex: -1, itemCount: 0 })).toEqual({ type: 'none' });
    expect(getSearchKeyboardAction({ key: 'Enter', activeIndex: -1, itemCount: 0 })).toEqual({ type: 'none' });
    expect(getSearchKeyboardAction({ key: 'Escape', activeIndex: -1, itemCount: 0 })).toEqual({ type: 'dismiss' });
  });

  it('supports first and last result shortcuts', () => {
    expect(getSearchKeyboardAction({ key: 'Home', activeIndex: 2, itemCount: 4 })).toEqual({
      type: 'move',
      index: 0,
    });
    expect(getSearchKeyboardAction({ key: 'End', activeIndex: 0, itemCount: 4 })).toEqual({
      type: 'move',
      index: 3,
    });
  });

  it('selects only a valid active result', () => {
    expect(getSearchKeyboardAction({ key: 'Enter', activeIndex: 1, itemCount: 2 })).toEqual({
      type: 'select',
      index: 1,
    });
    expect(getSearchKeyboardAction({ key: 'Enter', activeIndex: -1, itemCount: 2 })).toEqual({ type: 'none' });
    expect(getSearchKeyboardAction({ key: 'Enter', activeIndex: 2, itemCount: 2 })).toEqual({ type: 'none' });
  });

  it('dismisses on Escape and ignores unrelated keys', () => {
    expect(getSearchKeyboardAction({ key: 'Escape', activeIndex: 0, itemCount: 2 })).toEqual({ type: 'dismiss' });
    expect(getSearchKeyboardAction({ key: 'a', activeIndex: 0, itemCount: 2 })).toEqual({ type: 'none' });
  });
});
