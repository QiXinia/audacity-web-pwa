// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteBehaviorPanel } from './DeleteBehaviorPanel';

afterEach(() => cleanup());

describe('DeleteBehaviorPanel', () => {
  it('shows official leave/close choices and hides ripple details for leave gap', () => {
    render(
      <DeleteBehaviorPanel
        idPrefix="delete-test"
        deleteBehavior="leave-gap"
        closeGapBehavior="per-clip"
        onDeleteBehaviorChange={vi.fn()}
        onCloseGapBehaviorChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('delete-test-leave-gap')).toBeChecked();
    expect(screen.getByText('Leave gap')).toBeInTheDocument();
    expect(screen.getByText('Close gap (ripple)')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-test-close-gap-options')).not.toBeInTheDocument();
  });

  it('requests close gap and exposes all three official ripple choices', () => {
    const onDeleteBehaviorChange = vi.fn();
    const onCloseGapBehaviorChange = vi.fn();
    render(
      <DeleteBehaviorPanel
        idPrefix="delete-test"
        deleteBehavior="close-gap"
        closeGapBehavior="per-clip"
        onDeleteBehaviorChange={onDeleteBehaviorChange}
        onCloseGapBehaviorChange={onCloseGapBehaviorChange}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-test-per-track'));
    expect(onCloseGapBehaviorChange).toHaveBeenCalledWith('per-track');
    expect(screen.getByText('The selected clip moves back to fill the gap')).toBeInTheDocument();
    expect(screen.getByText('All clips on the same track move back to fill the gap')).toBeInTheDocument();
    expect(screen.getByText('All clips on all tracks move back to fill the gap')).toBeInTheDocument();
    expect(onDeleteBehaviorChange).not.toHaveBeenCalled();
  });

  it('requests leave gap when its card is selected', () => {
    const onDeleteBehaviorChange = vi.fn();
    render(
      <DeleteBehaviorPanel
        idPrefix="delete-test"
        deleteBehavior="close-gap"
        closeGapBehavior="all-tracks"
        onDeleteBehaviorChange={onDeleteBehaviorChange}
        onCloseGapBehaviorChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-test-leave-gap'));
    expect(onDeleteBehaviorChange).toHaveBeenCalledWith('leave-gap');
  });
});
