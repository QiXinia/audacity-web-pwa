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
        pasteAsNewClip={true}
        onPasteBehaviorChange={vi.fn()}
        onPasteInsertBehaviorChange={vi.fn()}
        onPasteAsNewClipChange={vi.fn()}
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
        pasteAsNewClip={true}
        onPasteBehaviorChange={onPasteBehaviorChange}
        onPasteInsertBehaviorChange={onPasteInsertBehaviorChange}
        onPasteAsNewClipChange={vi.fn()}
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
        pasteAsNewClip={false}
        onPasteBehaviorChange={onPasteBehaviorChange}
        onPasteInsertBehaviorChange={vi.fn()}
        onPasteAsNewClipChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('paste-test-overlap'));
    expect(onPasteBehaviorChange).toHaveBeenCalledWith('overlap');
  });

  it('exposes the official Always paste audio as a new clip checkbox', () => {
    const onPasteAsNewClipChange = vi.fn();
    render(
      <PasteBehaviorPanel
        idPrefix="paste-test"
        pasteBehavior="overlap"
        pasteInsertBehavior="per-track"
        pasteAsNewClip={false}
        onPasteBehaviorChange={vi.fn()}
        onPasteInsertBehaviorChange={vi.fn()}
        onPasteAsNewClipChange={onPasteAsNewClipChange}
      />,
    );
    const checkbox = screen.getByTestId('paste-test-as-new-clip');
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('Always paste audio as a new clip')).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(onPasteAsNewClipChange).toHaveBeenCalledWith(true);
  });
});
