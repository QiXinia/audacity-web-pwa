// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionContextMenu } from './SelectionContextMenu';

afterEach(() => cleanup());

function renderMenu(onPaste: (mode?: 'overlap' | 'per-track' | 'all-tracks') => void) {
  render(
    <SelectionContextMenu
      open
      x={20}
      y={20}
      hasClipboard
      onOpenChange={vi.fn()}
      onCut={vi.fn()}
      onCopy={vi.fn()}
      onPaste={onPaste}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onSplit={vi.fn()}
      onDisjoin={vi.fn()}
      onJoin={vi.fn()}
    />,
  );
}

describe('SelectionContextMenu default Paste', () => {
  it('leaves ordinary Paste unresolved so the editor can apply the saved preference', () => {
    const onPaste = vi.fn();
    renderMenu(onPaste);
    fireEvent.click(screen.getByTestId('selection-context-paste'));
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledWith();
  });
});
