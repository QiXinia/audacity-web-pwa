import { Label } from '@/components/ui/label';
import type {
  CloseGapBehavior,
  DeleteBehavior,
  SelectedDeleteBehavior,
} from '@/lib/deletePreferences';

const DELETE_OPTIONS: ReadonlyArray<{
  value: SelectedDeleteBehavior;
  title: string;
  description: string;
}> = [
  {
    value: 'leave-gap',
    title: 'Leave gap',
    description: '删除选区内容，保留空白，后续片段保持原位。',
  },
  {
    value: 'close-gap',
    title: 'Close gap (ripple)',
    description: '删除选区内容，并按下方所选范围移动片段填补空白。',
  },
];

const CLOSE_GAP_OPTIONS: ReadonlyArray<{
  value: CloseGapBehavior;
  text: string;
}> = [
  { value: 'per-clip', text: 'The selected clip moves back to fill the gap' },
  { value: 'per-track', text: 'All clips on the same track move back to fill the gap' },
  { value: 'all-tracks', text: 'All clips on all tracks move back to fill the gap' },
];

interface DeleteBehaviorPanelProps {
  idPrefix: string;
  deleteBehavior: DeleteBehavior;
  closeGapBehavior: CloseGapBehavior;
  onDeleteBehaviorChange: (value: SelectedDeleteBehavior) => void;
  onCloseGapBehaviorChange: (value: CloseGapBehavior) => void;
}

/** Shared Audacity 4 delete choices used by first-use onboarding and Edit Preferences. */
export function DeleteBehaviorPanel({
  idPrefix,
  deleteBehavior,
  closeGapBehavior,
  onDeleteBehaviorChange,
  onCloseGapBehaviorChange,
}: DeleteBehaviorPanelProps) {
  return (
    <div className="space-y-4" data-testid={idPrefix}>
      <div
        role="radiogroup"
        aria-label="Choose behavior when deleting a portion of a clip"
        className="grid gap-3 sm:grid-cols-2"
      >
        {DELETE_OPTIONS.map((option) => {
          const id = `${idPrefix}-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 font-normal transition-colors ${
                deleteBehavior === option.value ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
              }`}
            >
              <input
                id={id}
                data-testid={id}
                type="radio"
                name={`${idPrefix}-delete-behavior`}
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={deleteBehavior === option.value}
                onChange={() => onDeleteBehaviorChange(option.value)}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </Label>
          );
        })}
      </div>

      {deleteBehavior === 'close-gap' && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid={`${idPrefix}-close-gap-options`}>
          <p className="text-sm font-medium">When closing the gap, do the following</p>
          <div role="radiogroup" aria-label="Close gap behavior" className="space-y-2">
            {CLOSE_GAP_OPTIONS.map((option) => {
              const id = `${idPrefix}-${option.value}`;
              return (
                <Label key={option.value} htmlFor={id} className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    id={id}
                    data-testid={id}
                    type="radio"
                    name={`${idPrefix}-close-gap-behavior`}
                    className="size-4 accent-primary"
                    checked={closeGapBehavior === option.value}
                    onChange={() => onCloseGapBehaviorChange(option.value)}
                  />
                  <span className="text-sm">{option.text}</span>
                </Label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
