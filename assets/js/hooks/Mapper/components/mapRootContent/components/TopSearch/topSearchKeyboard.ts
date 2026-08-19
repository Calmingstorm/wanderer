export type SearchKeyboardAction =
  | { type: 'move'; index: number }
  | { type: 'select'; index: number }
  | { type: 'dismiss' }
  | { type: 'none' };

interface SearchKeyboardInput {
  key: string;
  activeIndex: number;
  itemCount: number;
}

export const clampSearchIndex = (index: number, itemCount: number): number => {
  if (itemCount <= 0) {
    return -1;
  }

  return Math.min(Math.max(index, 0), itemCount - 1);
};

export const getSearchKeyboardAction = ({ key, activeIndex, itemCount }: SearchKeyboardInput): SearchKeyboardAction => {
  if (itemCount <= 0) {
    return key === 'Escape' ? { type: 'dismiss' } : { type: 'none' };
  }

  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: clampSearchIndex(activeIndex + 1, itemCount) };
    case 'ArrowUp':
      return {
        type: 'move',
        index: clampSearchIndex(activeIndex < 0 ? itemCount - 1 : activeIndex - 1, itemCount),
      };
    case 'Home':
      return { type: 'move', index: clampSearchIndex(0, itemCount) };
    case 'End':
      return { type: 'move', index: clampSearchIndex(itemCount - 1, itemCount) };
    case 'Enter':
      return activeIndex >= 0 && activeIndex < itemCount ? { type: 'select', index: activeIndex } : { type: 'none' };
    case 'Escape':
      return { type: 'dismiss' };
    default:
      return { type: 'none' };
  }
};
