import React, { useCallback, useEffect, useRef, useState } from 'react';
import { computeMentionQuery, filterMentionCandidates, stripMentionToken } from '../../utils/mention';
import { basenameOf } from '../../utils/file-reference';

interface ReferenceMenuProps {
  /** Candidate workspace-relative paths to display. */
  items: string[];
  /** Index of the currently active (highlighted) item. */
  activeIndex: number;
  /** Called when the user selects a path (click). */
  onSelect: (path: string) => void;
  /** Called when the mouse hovers an item — updates activeIndex in the hook. */
  onHover: (index: number) => void;
  /** Whether the menu should be visible. */
  visible: boolean;
}

/**
 * Floating autocomplete menu for `@`-mention workspace-file references.
 * Pure render component — all state lives in the useReferenceMenu hook.
 * Mirrors SlashCommandMenu's positioning/keyboard contract.
 */
export default function ReferenceMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
  visible,
}: ReferenceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuRef.current) return;
    const els = menuRef.current.querySelectorAll('[data-ref-item]');
    els[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!visible || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      role="listbox"
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 4,
        maxHeight: 240,
        overflowY: 'auto',
        background: 'var(--surface, #1a1a2e)',
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        borderRadius: 8,
        boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
        zIndex: 100,
        padding: '4px 0',
      }}
    >
      {items.map((path, idx) => {
        const isActive = idx === activeIndex;
        const name = basenameOf(path);
        const dir = path.slice(0, path.length - name.length);
        return (
          <div
            key={path}
            data-ref-item
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => onHover(idx)}
            onMouseDown={(e) => {
              // mouseDown fires before textarea blur, preserving selection.
              e.preventDefault();
              onSelect(path);
            }}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              background: isActive ? 'var(--surface-hover, rgba(255,255,255,0.06))' : 'transparent',
              transition: 'background 0.1s',
            }}
          >
            <span
              style={{
                fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                fontSize: 13,
                color: 'var(--accent-secondary, #3B82F6)',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              @{name}
            </span>
            {dir && (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary, #71717a)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {dir}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Hook: single source of truth for the `@`-mention reference menu.
 *
 * @param text     current composer text
 * @param cursor   caret position within `text`
 * @param paths    workspace-relative file paths to match against
 * @param onComplete  invoked with (selectedPath, strippedText, caret) when a
 *        path is chosen — caller adds the reference and rewrites the textarea.
 */
export function useReferenceMenu(
  text: string,
  cursor: number,
  paths: string[],
  onComplete: (path: string, strippedText: string, caret: number) => void,
) {
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const mention = computeMentionQuery(text, cursor);
  const visible = mention !== null && !dismissed;
  const items = visible ? filterMentionCandidates(paths, mention!.query) : [];

  // Re-arm the menu whenever the active mention token disappears.
  useEffect(() => {
    if (!mention) setDismissed(false);
  }, [mention]);

  // Reset highlight as the query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query]);

  const handleSelect = useCallback(
    (path: string) => {
      const token = computeMentionQuery(text, cursor);
      if (token) {
        const { text: next, cursor: caret } = stripMentionToken(text, token);
        onComplete(path, next, caret);
      } else {
        onComplete(path, text, cursor);
      }
      setDismissed(true);
    },
    [text, cursor, onComplete],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!visible || items.length === 0) return false;
      if (e.nativeEvent.isComposing || e.keyCode === 229) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % items.length);
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        case 'Tab':
        case 'Enter':
          e.preventDefault();
          if (items[activeIndex]) handleSelect(items[activeIndex]);
          return true;
        case 'Escape':
          e.preventDefault();
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [visible, items, activeIndex, handleSelect],
  );

  return {
    visible,
    items,
    activeIndex,
    setActiveIndex,
    handleSelect,
    handleKeyDown,
    dismiss: () => setDismissed(true),
  };
}
