import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RepeatSelectionDialog from '@/pages/AudioEditorPage/sections/RepeatSelectionDialog';

function renderDialog(overrides: Partial<Parameters<typeof RepeatSelectionDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    selectionDuration: 1.25,
    sampleRate: 10,
    isRepeating: false,
    onRepeat: vi.fn(),
    ...overrides,
  };
  return { ...render(<RepeatSelectionDialog {...props} />), props };
}

describe('RepeatSelectionDialog', () => {
  it('shows Audacity repeat defaults and the original plus expanded selection lengths', () => {
    renderDialog();
    expect(screen.getByLabelText('新增重复次数')).toHaveValue(1);
    expect(screen.getByText('00:01.250')).toBeInTheDocument();
    expect(screen.getByText('00:02.500')).toBeInTheDocument();
  });

  it('submits the requested number of added copies', () => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('新增重复次数'), { target: { value: '2' } });
    expect(screen.getByText('00:03.750')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用重复' }));
    expect(props.onRepeat).toHaveBeenCalledWith(2);
  });

  it.each(['', '0', '-1', '1.5', '214748365'])('rejects invalid count %j without processing', (value) => {
    const { props } = renderDialog();
    fireEvent.change(screen.getByLabelText('新增重复次数'), { target: { value } });
    expect(screen.getByRole('alert')).toHaveTextContent('零次或无效次数不会修改音频');
    expect(screen.getByRole('button', { name: '应用重复' })).toBeDisabled();
    expect(props.onRepeat).not.toHaveBeenCalled();
  });

  it('resets to one added repeat on each open and disables commands while processing', () => {
    const { rerender, props } = renderDialog();
    fireEvent.change(screen.getByLabelText('新增重复次数'), { target: { value: '3' } });
    rerender(<RepeatSelectionDialog {...props} open={false} />);
    rerender(<RepeatSelectionDialog {...props} open />);
    expect(screen.getByLabelText('新增重复次数')).toHaveValue(1);

    rerender(<RepeatSelectionDialog {...props} open isRepeating />);
    expect(screen.getByLabelText('新增重复次数')).toBeDisabled();
    expect(screen.getByRole('button', { name: '重复中…' })).toBeDisabled();
  });
});
