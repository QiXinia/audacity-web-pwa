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
  DEFAULT_NOISE_REDUCTION_SETTINGS,
  validateNoiseReductionSettings,
  type NoiseReductionMode,
  type NoiseReductionProfile,
  type NoiseReductionSettings,
} from '@/lib/noiseReductionEffect';
import type { PreviewChannels } from '@/lib/generatorPreview';
import { useGeneratorPreview } from './useGeneratorPreview';

interface NoiseReductionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  selectionStart: number;
  selectionEnd: number;
  hasSelection: boolean;
  isApplying: boolean;
  profile: NoiseReductionProfile | null;
  onGetProfile: () => void | Promise<void>;
  onClearProfile: () => void;
  onPreview: (settings: NoiseReductionSettings, profile: NoiseReductionProfile) => Promise<PreviewChannels>;
  onApply: (settings: NoiseReductionSettings, profile: NoiseReductionProfile) => void | Promise<void>;
}

type NumericField = 'noiseGain' | 'sensitivity' | 'frequencySmoothingBands';
type Drafts = Record<NumericField, string>;

const DEFAULT_DRAFTS: Drafts = {
  noiseGain: String(DEFAULT_NOISE_REDUCTION_SETTINGS.noiseGain),
  sensitivity: String(DEFAULT_NOISE_REDUCTION_SETTINGS.sensitivity),
  frequencySmoothingBands: String(DEFAULT_NOISE_REDUCTION_SETTINGS.frequencySmoothingBands),
};

const CONTROLS: Record<NumericField, { label: string; minimum: number; maximum: number; step: number }> = {
  noiseGain: { label: 'Noise reduction (dB)', minimum: 0, maximum: 48, step: 1 },
  sensitivity: { label: 'Sensitivity', minimum: 0.01, maximum: 24, step: 0.01 },
  frequencySmoothingBands: { label: 'Frequency smoothing (bands)', minimum: 0, maximum: 12, step: 1 },
};

function NoiseReductionControl({ field, value, onChange }: {
  field: NumericField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { label, minimum, maximum, step } = CONTROLS[field];
  const sliderValue = Number(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`noise-reduction-${field}`}>{label}</Label>
        <Input
          id={`noise-reduction-${field}`}
          data-testid={`noise-reduction-${field}-input`}
          type="number"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-28"
          required
        />
      </div>
      <input
        type="range"
        aria-label={`${label}滑块`}
        min={minimum}
        max={maximum}
        step={step}
        value={Number.isFinite(sliderValue) ? sliderValue : minimum}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
    </div>
  );
}

export default function NoiseReductionDialog({
  open,
  onOpenChange,
  sampleRate,
  selectionStart,
  selectionEnd,
  hasSelection,
  isApplying,
  profile,
  onGetProfile,
  onClearProfile,
  onPreview,
  onApply,
}: NoiseReductionDialogProps) {
  const [drafts, setDrafts] = useState<Drafts>({ ...DEFAULT_DRAFTS });
  const [mode, setMode] = useState<NoiseReductionMode>(DEFAULT_NOISE_REDUCTION_SETTINGS.mode);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const settings = useMemo<NoiseReductionSettings>(() => ({
    noiseGain: Number(drafts.noiseGain),
    sensitivity: Number(drafts.sensitivity),
    frequencySmoothingBands: Number(drafts.frequencySmoothingBands),
    mode,
  }), [drafts, mode]);
  const validationError = useMemo(() => {
    if (Object.values(drafts).some((value) => !value.trim())) return '请填写全部 Noise Reduction 参数';
    try {
      validateNoiseReductionSettings(settings);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Noise Reduction 参数无效';
    }
  }, [drafts, settings]);
  const profileError = profile && profile.sampleRate !== sampleRate
    ? 'Noise Profile 与当前工程采样率不一致，请重新获取。'
    : '';
  const canProcess = hasSelection && Boolean(profile) && !profileError && !validationError && !isApplying;

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function changeDraft(field: NumericField, value: string) {
    setDrafts((current) => ({ ...current, [field]: value }));
    stopPreview();
  }

  function reset() {
    setDrafts({ ...DEFAULT_DRAFTS });
    setMode(DEFAULT_NOISE_REDUCTION_SETTINGS.mode);
    stopPreview();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canProcess || !profile) return;
    stopPreview();
    void onApply(settings, profile);
  }

  function preview() {
    if (!canProcess || !profile) return;
    void startPreview(() => onPreview(settings, profile), sampleRate);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="noise-reduction-dialog">
        <DialogHeader>
          <DialogTitle>Noise Reduction 降噪</DialogTitle>
          <DialogDescription>
            按 Audacity 4.0.2 官方 2048 点 Hann/Hann STFT、第二高功率判别和时间/频率平滑执行两步降噪。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <section className="space-y-3 rounded-md border p-4" aria-labelledby="noise-profile-step">
            <h3 id="noise-profile-step" className="text-sm font-medium">Step 1：选择纯噪声并获取 Noise Profile</h3>
            <p className="text-xs text-muted-foreground">
              当前选区：{formatTime(selectionStart)}–{formatTime(selectionEnd)}。成功后对话框关闭；重新选择待处理音频，再从效果菜单打开。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" disabled={!hasSelection || isApplying} onClick={() => void onGetProfile()}>
                Get Noise Profile
              </Button>
              {profile && (
                <Button type="button" variant="ghost" disabled={isApplying} onClick={onClearProfile}>清除 Profile</Button>
              )}
            </div>
            <p className="text-xs" data-testid="noise-profile-status">
              {profile
                ? `已学习 ${profile.totalWindows} 个窗口，${profile.means.length} 个频谱 bin，采样率 ${profile.sampleRate} Hz`
                : '尚未获取 Noise Profile；至少需要 2048 个采样。'}
            </p>
          </section>

          <fieldset className="grid gap-4 rounded-md border p-4" disabled={isApplying}>
            <legend className="px-1 text-sm font-medium">Step 2：选择待处理音频并调整参数</legend>
            {(Object.keys(CONTROLS) as NumericField[]).map((field) => (
              <NoiseReductionControl
                key={field}
                field={field}
                value={drafts[field]}
                onChange={(value) => changeDraft(field, value)}
              />
            ))}
            <div className="space-y-2" role="radiogroup" aria-label="输出模式">
              <Label>输出模式</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="noise-reduction-mode"
                  value="reduce"
                  checked={mode === 'reduce'}
                  onChange={() => { setMode('reduce'); stopPreview(); }}
                />
                Audio with noise removed
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="noise-reduction-mode"
                  value="residue"
                  checked={mode === 'residue'}
                  onChange={() => { setMode('residue'); stopPreview(); }}
                />
                Noise only (residue)
              </label>
            </div>
          </fieldset>

          {!hasSelection && <p role="alert" className="text-sm text-destructive">请先选择要处理的音频</p>}
          {!profile && <p className="text-sm text-muted-foreground">获取 Profile 后才可试听或应用。</p>}
          {profileError && <p role="alert" className="text-sm text-destructive">{profileError}</p>}
          {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
          {previewError && <p role="alert" className="text-sm text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isApplying} onClick={reset}>恢复默认</Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={!canProcess}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={!canProcess}>
              {isApplying ? '正在应用…' : '应用 Noise Reduction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
