import { Label } from '@/components/ui/label';
import type {
  PasteBehavior,
  PasteInsertBehavior,
} from '@/lib/pastePreferences';

const PASTE_OPTIONS: ReadonlyArray<{
  value: PasteBehavior;
  title: string;
  description: string;
}> = [
  {
    value: 'overlap',
    title: 'Paste overlaps other clips',
    description: '粘贴覆盖时间范围内的现有内容，范围之外的 Clip 保持原位。',
  },
  {
    value: 'insert',
    title: 'Paste pushes other clips',
    description: '粘贴前先腾出空白，并按下方所选范围移动现有 Clip。',
  },
];

const INSERT_OPTIONS: ReadonlyArray<{
  value: PasteInsertBehavior;
  text: string;
}> = [
  { value: 'per-track', text: 'Pasting audio pushes other clips on the same track' },
  { value: 'all-tracks', text: 'Pasting audio pushes all clips on all tracks' },
];

interface PasteBehaviorPanelProps {
  idPrefix: string;
  pasteBehavior: PasteBehavior;
  pasteInsertBehavior: PasteInsertBehavior;
  pasteAsNewClip: boolean;
  onPasteBehaviorChange: (value: PasteBehavior) => void;
  onPasteInsertBehaviorChange: (value: PasteInsertBehavior) => void;
  onPasteAsNewClipChange: (value: boolean) => void;
}

/** Shared Audacity 4 Edit Preferences choices for the ordinary Paste command. */
export function PasteBehaviorPanel({
  idPrefix,
  pasteBehavior,
  pasteInsertBehavior,
  pasteAsNewClip,
  onPasteBehaviorChange,
  onPasteInsertBehaviorChange,
  onPasteAsNewClipChange,
}: PasteBehaviorPanelProps) {
  return (
    <div className="space-y-4" data-testid={idPrefix}>
      <div
        role="radiogroup"
        aria-label="Choose behavior when pasting audio"
        className="grid gap-3 sm:grid-cols-2"
      >
        {PASTE_OPTIONS.map((option) => {
          const id = `${idPrefix}-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 font-normal transition-colors ${
                pasteBehavior === option.value ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
              }`}
            >
              <input
                id={id}
                data-testid={id}
                type="radio"
                name={`${idPrefix}-paste-behavior`}
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={pasteBehavior === option.value}
                onChange={() => onPasteBehaviorChange(option.value)}
              />
              <span className="space-y-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </Label>
          );
        })}
      </div>

      {pasteBehavior === 'insert' && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-4" data-testid={`${idPrefix}-insert-options`}>
          <p className="text-sm font-medium">When making room for pasted audio, do the following</p>
          <div role="radiogroup" aria-label="Paste insert behavior" className="space-y-2">
            {INSERT_OPTIONS.map((option) => {
              const id = `${idPrefix}-${option.value}`;
              return (
                <Label key={option.value} htmlFor={id} className="flex cursor-pointer items-center gap-2 font-normal">
                  <input
                    id={id}
                    data-testid={id}
                    type="radio"
                    name={`${idPrefix}-paste-insert-behavior`}
                    className="size-4 accent-primary"
                    checked={pasteInsertBehavior === option.value}
                    onChange={() => onPasteInsertBehaviorChange(option.value)}
                  />
                  <span className="text-sm">{option.text}</span>
                </Label>
              );
            })}
          </div>
        </div>
      )}

      <Label
        htmlFor={`${idPrefix}-as-new-clip`}
        className="flex cursor-pointer items-start gap-3 rounded-md border p-4 font-normal"
      >
        <input
          id={`${idPrefix}-as-new-clip`}
          data-testid={`${idPrefix}-as-new-clip`}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={pasteAsNewClip}
          onChange={(event) => onPasteAsNewClipChange(event.target.checked)}
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium">Always paste audio as a new clip</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            关闭后，在既有 Clip 内执行非全轨粘贴时，将音频插入并合并为一个 Clip。
          </span>
        </span>
      </Label>
    </div>
  );
}
