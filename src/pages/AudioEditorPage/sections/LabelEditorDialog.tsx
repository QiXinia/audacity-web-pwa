import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { generateId } from '@/lib/audioUtils';
import type { IAnalysisLabel, ITrack } from '@/types/project';

function validateDraft(draft: readonly IAnalysisLabel[], tracks: readonly ITrack[]): string | null {
  if (tracks.length === 0) return '工程中没有可归属的轨道';
  const trackIds = new Set(tracks.map((track) => track.id));
  for (const [index, label] of draft.entries()) {
    if (!trackIds.has(label.trackId)) return `第 ${index + 1} 行的轨道已不存在，请重新选择`;
    if (!Number.isFinite(label.start) || label.start < 0) return `第 ${index + 1} 行开始时间必须是不小于 0 的有限秒数`;
    if (!Number.isFinite(label.end) || label.end < label.start) return `第 ${index + 1} 行结束时间不能早于开始时间`;
  }
  return null;
}

export default function LabelEditorDialog({
  open,
  onOpenChange,
  labels,
  tracks,
  selectedTrackId,
  selection,
  isApplying,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: readonly IAnalysisLabel[];
  tracks: readonly ITrack[];
  selectedTrackId: string | null;
  selection: { start: number; end: number } | null;
  isApplying: boolean;
  onApply: (labels: IAnalysisLabel[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<IAnalysisLabel[]>([]);
  const [selectedRow, setSelectedRow] = useState(0);
  const [applyError, setApplyError] = useState<string | null>(null);

  function newManualLabel(): IAnalysisLabel {
    const trackId = tracks.some((track) => track.id === selectedTrackId)
      ? selectedTrackId!
      : tracks[0]?.id ?? '';
    const start = selection?.start ?? 0;
    return {
      id: generateId(), kind: 'manual', trackId,
      start, end: selection?.end ?? start, text: '',
    };
  }

  useEffect(() => {
    if (!open) return;
    const initial = labels.map((label) => ({ ...label }));
    setDraft(initial.length > 0 ? initial : [newManualLabel()]);
    setSelectedRow(0);
    setApplyError(null);
    // The dialog is a transactional snapshot; live project updates do not overwrite edits.
  }, [open]);

  const validationError = validateDraft(draft, tracks);

  function updateRow(index: number, updates: Partial<IAnalysisLabel>) {
    setSelectedRow(index);
    setDraft((current) => current.map((label, row) => row === index ? { ...label, ...updates } : label));
  }

  function insertLabel() {
    const inserted = newManualLabel();
    setDraft((current) => {
      const index = Math.min(selectedRow + 1, current.length);
      return [...current.slice(0, index), inserted, ...current.slice(index)];
    });
    setSelectedRow((current) => Math.min(current + 1, draft.length));
  }

  function deleteSelectedLabel() {
    if (draft.length === 0) return;
    const index = Math.min(selectedRow, draft.length - 1);
    setDraft((current) => current.filter((_label, row) => row !== index));
    setSelectedRow(Math.max(0, index - 1));
  }

  async function apply() {
    if (validationError || isApplying) return;
    setApplyError(null);
    try {
      await onApply(draft.map((label) => ({ ...label })));
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isApplying) onOpenChange(next); }}>
      <DialogContent data-testid="label-editor-dialog" className="max-w-[920px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Edit Labels</DialogTitle>
          <DialogDescription>编辑标签文本、轨道归属和起止时间；单击行后 Insert/Delete，OK 一次提交。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="max-h-[380px] overflow-auto rounded-md border">
            <table className="w-full min-w-[690px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-secondary text-secondary-foreground">
                <tr>
                  <th className="w-40 px-3 py-2 font-medium">Track 轨道</th>
                  <th className="px-3 py-2 font-medium">Label text 标签文本</th>
                  <th className="w-36 px-3 py-2 font-medium">Start time (s)</th>
                  <th className="w-36 px-3 py-2 font-medium">End time (s)</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((label, index) => (
                  <tr
                    key={label.id}
                    aria-selected={selectedRow === index}
                    className={selectedRow === index ? 'bg-accent/70' : 'bg-background'}
                    onClick={() => setSelectedRow(index)}
                  >
                    <td className="border-t px-2 py-1.5">
                      <select
                        aria-label={`轨道 ${index + 1}`}
                        className="h-8 w-full rounded-md border border-input bg-background px-2"
                        value={label.trackId}
                        disabled={isApplying}
                        onFocus={() => setSelectedRow(index)}
                        onChange={(event) => updateRow(index, { trackId: event.target.value })}
                      >
                        {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
                      </select>
                    </td>
                    <td className="border-t px-2 py-1.5">
                      <Input
                        aria-label={`标签文本 ${index + 1}`}
                        value={label.text}
                        disabled={isApplying}
                        onFocus={() => setSelectedRow(index)}
                        onChange={(event) => updateRow(index, { text: event.target.value })}
                      />
                      {label.kind === 'clipping' && (
                        <span className="mt-1 block text-[10px] text-muted-foreground">Clipping · 声道 {(label.channelIndex ?? 0) + 1}</span>
                      )}
                    </td>
                    <td className="border-t px-2 py-1.5">
                      <Input
                        aria-label={`开始时间 ${index + 1}`}
                        type="number" min={0} step={0.001}
                        value={Number.isFinite(label.start) ? label.start : ''}
                        disabled={isApplying}
                        onFocus={() => setSelectedRow(index)}
                        onChange={(event) => {
                          const start = event.target.valueAsNumber;
                          updateRow(index, { start, end: Number.isFinite(start) && start > label.end ? start : label.end });
                        }}
                      />
                    </td>
                    <td className="border-t px-2 py-1.5">
                      <Input
                        aria-label={`结束时间 ${index + 1}`}
                        type="number" min={0} step={0.001}
                        value={Number.isFinite(label.end) ? label.end : ''}
                        disabled={isApplying}
                        onFocus={() => setSelectedRow(index)}
                        onChange={(event) => {
                          const end = event.target.valueAsNumber;
                          updateRow(index, { end, start: Number.isFinite(end) && end < label.start ? end : label.start });
                        }}
                      />
                    </td>
                  </tr>
                ))}
                {draft.length === 0 && (
                  <tr><td colSpan={4} className="border-t px-3 py-8 text-center text-muted-foreground">暂无标签，选择 Insert 添加。</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={isApplying || tracks.length === 0} onClick={insertLabel}>Insert</Button>
            <Button type="button" variant="outline" size="sm" disabled={isApplying || draft.length === 0} onClick={deleteSelectedLabel}>Delete</Button>
          </div>
          {(validationError || applyError) && <p role="alert" className="text-xs text-destructive">{validationError ?? applyError}</p>}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={isApplying} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={Boolean(validationError) || isApplying} onClick={() => { void apply(); }}>
            {isApplying ? '保存中…' : 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
