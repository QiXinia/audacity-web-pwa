// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasteBehaviorPanel } from './PasteBehaviorPanel';

afterEach(() => cleanup());

describe('PasteBehaviorPanel', () => {
  it('shows official overlap/insert choices and hides insertion details for overlap', () => {
    render(
      <PasteBehaviorPanel
        idPrefix="paste-test"
        pasteBehavior="overlap"
        pasteInsertBehavior="per-track"
        onPasteBehaviorChange={vi.fn()}
        onPasteInsertBehaviorChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('paste-test-overlap')).toBeChecked();
    expect(screen.getByText('Paste overlaps other clips')).toBeInTheDocument();
    expect(screen.getByText('Paste pushes other clips')).toBeInTheDocument();
    expect(screen.queryByTestId('paste-test-insert-options')).not.toBeInTheDocument();
  });

  it('requests insertion and exposes both official ripple scopes', () => {
    const onPasteBehaviorChange = vi.fn();
    const onPasteInsertBehaviorChange = vi.fn();
    render(
      <PasteBehaviorPanel
        idPrefix="paste-test"
        pasteBehavior="insert"
        pasteInsertBehavior="per-track"
        onPasteBehaviorChange={onPasteBehaviorChange}
        onPasteInsertBehaviorChange={onPasteInsertBehaviorChange}
      />,
    );
    fireEvent.click(screen.getByTestId('paste-test-all-tracks'));
    expect(onPasteInsertBehaviorChange).toHaveBeenCalledWith('all-tracks');
    expect(screen.getByText('Pasting audio pushes other clips on the same track')).toBeInTheDocument();
    expect(screen.getByText('Pasting audio pushes all clips on all tracks')).toBeInTheDocument();
    expect(onPasteBehaviorChange).not.toHaveBeenCalled();
  });

  it('requests overlap when its card is selected', () => {
    const onPasteBehaviorChange = vi.fn();
    render(
      <PasteBehaviorPanel
        idPrefix="paste-test"
        pasteBehavior="insert"
        pasteInsertBehavior="all-tracks"
        onPasteBehaviorChange={onPasteBehaviorChange}
        onPasteInsertBehaviorChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('paste-test-overlap'));
    expect(onPasteBehaviorChange).toHaveBeenCalledWith('overlap');
  });
});
