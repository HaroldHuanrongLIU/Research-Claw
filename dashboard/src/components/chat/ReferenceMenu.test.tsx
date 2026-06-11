import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useReferenceMenu } from './ReferenceMenu';

const PATHS = ['sources/paper.pdf', 'sources/paper-v2.pdf', 'uploads/data.csv'];

describe('useReferenceMenu', () => {
  it('is hidden when there is no active @ token', () => {
    const { result } = renderHook(() => useReferenceMenu('hello world', 11, PATHS, vi.fn()));
    expect(result.current.visible).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('becomes visible and filters candidates for an @query', () => {
    const { result } = renderHook(() => useReferenceMenu('@paper', 6, PATHS, vi.fn()));
    expect(result.current.visible).toBe(true);
    expect(result.current.items).toContain('sources/paper.pdf');
    expect(result.current.items).not.toContain('uploads/data.csv');
  });

  it('handleSelect strips the @token and reports the chosen path + caret', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useReferenceMenu('read @pap', 9, PATHS, onComplete));
    act(() => result.current.handleSelect('sources/paper.pdf'));
    expect(onComplete).toHaveBeenCalledWith('sources/paper.pdf', 'read ', 5);
  });

  it('does not trigger on an email-like @ (no whitespace before)', () => {
    const { result } = renderHook(() => useReferenceMenu('a@b.com', 7, PATHS, vi.fn()));
    expect(result.current.visible).toBe(false);
  });

  it('Escape dismisses and re-arms only after the token clears', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ text, cursor }) => useReferenceMenu(text, cursor, PATHS, onComplete),
      { initialProps: { text: '@pap', cursor: 4 } },
    );
    expect(result.current.visible).toBe(true);

    const escEvt = { key: 'Escape', preventDefault: vi.fn(), nativeEvent: { isComposing: false }, keyCode: 27 } as never;
    let consumed = false;
    act(() => {
      consumed = result.current.handleKeyDown(escEvt);
    });
    expect(consumed).toBe(true);
    rerender({ text: '@pap', cursor: 4 });
    expect(result.current.visible).toBe(false);

    // Clearing the token re-arms the menu for the next @.
    rerender({ text: 'cleared', cursor: 7 });
    rerender({ text: '@dat', cursor: 4 });
    expect(result.current.visible).toBe(true);
  });
});
