import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatTime } from '@/lib/audioUtils';
import {
  applyLinkedToneChange,
  DEFAULT_BASS_TREBLE_SETTINGS,
  isBassTrebleBypassed,
  validateBassTrebleSettings,
  type BassTrebleSettings,
} from '@/lib/bassTrebleEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface BassTrebleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  onPreview: (settings: BassTrebleSettings) => Promise<PreviewChannels>;
  onApply: (settings: BassTrebleSettings) => void | Promise<void>;
}

type NumericField = 'bassDb' | 'trebleDb' | 'gainDb';
type Drafts = Record<NumericField, string>;

interface ToneControlProps {
  id: string;
  label: string;
  value: string;
  sliderValue: number;
  disabled: boolean;
  onTextChange: (value: string) => void;
  onSliderChange: (value: number) => void;
}

function ToneControl({
  id, label, value, sliderValue, disabled, onTextChange, onSliderChange,
}: ToneControlProps) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          type="number"
          min={-30}
          max={30}
          step={0.1}
          value={value}
          disabled={disabled}
          onChange={(event) => onTextChange(event.target.value)}
          className="w-24"
          required
        />
        <input
          type="range"
          aria-label={`${label}滑块`}
          min={-30}
          max={30}
          step={0.1}
          value={Number.isFinite(sliderValue) ? sliderValue : 0}
          disabled={disabled}
          onChange={(event) => onSliderChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-primary"
        />
      </div>
    </div>
  );
}

export default function BassTrebleDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  onPreview,
  onApply,
}: BassTrebleDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ bassDb: '0.0', trebleDb: '0.0', gainDb: '0.0' });
  const [linkSliders, setLinkSliders] = useState(false);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<BassTrebleSettings>(() => ({
    bassDb: Number(drafts.bassDb),
    trebleDb: Number(drafts.trebleDb),
    gainDb: Number(drafts.gainDb),
    linkSliders,
  }), [drafts, linkSliders]);

  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) {
      return '请填写低音、高音和输出音量';
    }
    try {
      validateBassTrebleSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '低音和高音参数无效';
    }
  }, [drafts, settings]);
  const bypassed = !validationError && isBassTrebleBypassed(settings);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function changeTone(control: 'bass' | 'treble', value: string) {
    const field: NumericField = control === 'bass' ? 'bassDb' : 'trebleDb';
    const nextValue = Number(value);
    if (!validationError && value.trim() && Number.isFinite(nextValue)) {
      try {
        const next = applyLinkedToneChange(settings, control, nextValue);
        setDrafts({ ...drafts, [field]: value, gainDb: String(next.gainDb) });
        return;
      } catch {
        // Preserve the draft; validation below disables preview/apply until it is valid.
      }
    }
    setDrafts({ ...drafts, [field]: value });
  }

  function changeGain(value: string) {
    setDrafts({ ...drafts, gainDb: value });
  }

  function reset() {
    setDrafts({
      bassDb: String(DEFAULT_BASS_TREBLE_SETTINGS.bassDb),
      trebleDb: String(DEFAULT_BASS_TREBLE_SETTINGS.trebleDb),
      gainDb: String(DEFAULT_BASS_TREBLE_SETTINGS.gainDb),
    });
    setLinkSliders(DEFAULT_BASS_TREBLE_SETTINGS.linkSliders);
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError || bypassed || !hasSelection || isApplying) return;
    stopPreview();
    void onApply(settings);
  }

  function preview() {
    if (validationError || !hasSelection || isApplying) return;
    void startPreview(() => onPreview(settings), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>低音和高音</DialogTitle>
          <DialogDescription>
            按 Audacity Bass and Treble 使用 250 Hz 低架与 4 kHz 高架滤波器处理选区。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset className="space-y-3 rounded-md border p-4" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">音调控制</legend>
            <ToneControl
              id="bass-treble-bass"
              label="低音（dB）"
              value={drafts.bassDb}
              sliderValue={settings.bassDb}
              disabled={isApplying}
              onTextChange={(value) => changeTone('bass', value)}
              onSliderChange={(value) => changeTone('bass', String(value))}
            />
            <ToneControl
              id="bass-treble-treble"
              label="高音（dB）"
              value={drafts.trebleDb}
              sliderValue={settings.trebleDb}
              disabled={isApplying}
              onTextChange={(value) => changeTone('treble', value)}
              onSliderChange={(value) => changeTone('treble', String(value))}
            />
          </fieldset>
          <fieldset className="space-y-3 rounded-md border p-4" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">输出</legend>
            <ToneControl
              id="bass-treble-gain"
              label="输出音量（dB）"
              value={drafts.gainDb}
              sliderValue={settings.gainDb}
              disabled={isApplying}
              onTextChange={changeGain}
              onSliderChange={(value) => changeGain(String(value))}
            />
            <div className="flex items-start gap-2">
              <input
                id="bass-treble-link"
                type="checkbox"
                aria-label="音量随音调联动"
                checked={linkSliders}
                disabled={isApplying}
                onChange={(event) => setLinkSliders(event.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <Label htmlFor="bass-treble-link" className="font-normal leading-5">
                音量随音调联动
                <span className="block text-xs text-muted-foreground">
                  提升音调时补偿一半增量，削减音调时补偿四分之一增量；输出音量限制在 ±30 dB。
                </span>
              </Label>
            </div>
          </fieldset>
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}，共 {formatTime(Math.max(0, selectionEnd - selectionStart))}</p>
            <p>每条轨道、每个声道独立保留滤波状态，并跨所选片段连续处理。试听仅使用第一条含音频的轨道。</p>
          </div>
          {!hasSelection && <p role="alert" className="text-sm text-destructive">请先选择要处理的音频</p>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {bypassed && <p className="text-sm text-muted-foreground">三项参数均为 0 dB 时按 Audacity 行为跳过处理。</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isApplying || !hasSelection || Boolean(validationError)}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isApplying || !hasSelection || Boolean(validationError) || bypassed}>
              {isApplying ? '正在应用…' : '应用低音和高音'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
