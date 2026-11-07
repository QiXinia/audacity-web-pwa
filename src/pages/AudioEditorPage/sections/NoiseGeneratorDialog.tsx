import { useEffect, useState, type FormEvent } from 'react';
import { nanoid } from 'nanoid';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime } from '@/lib/audioUtils';
import { formatGeneratorDuration } from '@/lib/generatorDuration';
import {
  deleteGeneratorPreset,
  GENERATOR_PRESET_FACTORY_ID,
  isValidGeneratorPresetSettings,
  loadGeneratorPresetStore,
  saveGeneratorPresetStore,
  upsertGeneratorPreset,
  type GeneratorPreset,
  type GeneratorPresetStore,
  type NoisePresetSettings,
} from '@/lib/generatorPresets';
import { generateNoise, type NoiseRequest, type NoiseType } from '@/lib/noiseGenerator';
import GeneratorPresetsBar from './GeneratorPresetsBar';
import { useGeneratorPreview } from './useGeneratorPreview';

interface NoiseGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  isGenerating: boolean;
  onGenerate: (settings: NoiseRequest) => void | Promise<void>;
}

export default function NoiseGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  selectionActive = false,
  replacementPosition,
  isGenerating,
  onGenerate,
}: NoiseGeneratorDialogProps) {
  const [presetStore, setPresetStore] = useState(() => loadGeneratorPresetStore('noise'));
  const initialPreset = presetStore.presets.find((preset) => preset.id === presetStore.activeId)
    ?? presetStore.presets[0];
  const [type, setType] = useState<NoiseType>(initialPreset.settings.type);
  const [amplitude, setAmplitude] = useState(String(initialPreset.settings.amplitude));
  const [duration, setDuration] = useState('30');
  const [presetError, setPresetError] = useState<string | null>(null);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const activePreset = presetStore.presets.find((preset) => preset.id === presetStore.activeId)
    ?? presetStore.presets[0];
  const presetDirty = type !== activePreset.settings.type
    || Number(amplitude) !== activePreset.settings.amplitude;

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(formatGeneratorDuration(defaultDuration));
    }
  }, [open, defaultDuration]);

  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) stopPreview();
    onOpenChange(nextOpen);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    stopPreview();
    void onGenerate({ type, amplitude: Number(amplitude), duration: Number(duration) });
  }

  function preview() {
    void startPreview(() => generateNoise({
      type,
      amplitude: Number(amplitude),
      duration: Number(duration),
      sampleRate,
    }), sampleRate);
  }

  function applyPreset(preset: GeneratorPreset<'noise'>) {
    stopPreview();
    setType(preset.settings.type);
    setAmplitude(String(preset.settings.amplitude));
  }

  function commitPresetStore(next: GeneratorPresetStore<'noise'>): boolean {
    if (!saveGeneratorPresetStore('noise', next)) {
      setPresetError('预设保存失败：浏览器存储不可用。');
      return false;
    }
    setPresetStore(next);
    setPresetError(null);
    return true;
  }

  function selectPreset(id: string) {
    const preset = presetStore.presets.find((candidate) => candidate.id === id);
    if (preset && commitPresetStore({ ...presetStore, activeId: id })) applyPreset(preset);
  }

  function savePreset(name: string): boolean {
    const settings: NoisePresetSettings = { type, amplitude: Number(amplitude) };
    if (!isValidGeneratorPresetSettings('noise', settings)) {
      setPresetError('请先输入有效的噪声类型和振幅。');
      return false;
    }
    const existing = presetStore.presets.find((preset) => (
      preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    ));
    if (existing?.builtIn) {
      setPresetError('内置预设不可覆盖，请使用其他名称。');
      return false;
    }
    if (existing && !window.confirm(`预设“${existing.name}”已存在，是否替换？`)) return false;
    try {
      const next = upsertGeneratorPreset(
        presetStore,
        existing?.id ?? nanoid(10),
        name,
        settings,
      );
      return commitPresetStore(next);
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : '预设保存失败。');
      return false;
    }
  }

  function resetPreset() {
    applyPreset(activePreset);
    setPresetError(null);
  }

  function deleteActivePreset() {
    if (activePreset.id === GENERATOR_PRESET_FACTORY_ID) return;
    if (!window.confirm(`确定删除预设“${activePreset.name}”？`)) return;
    const next = deleteGeneratorPreset(presetStore, activePreset.id);
    if (commitPresetStore(next)) {
      applyPreset(next.presets.find((preset) => preset.id === next.activeId) ?? next.presets[0]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成噪声</DialogTitle>
          <DialogDescription>
            按 Audacity Noise 的白噪声、粉红噪声和布朗噪声算法生成真实单声道音频片段。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <GeneratorPresetsBar
            kind="noise"
            store={presetStore}
            dirty={presetDirty}
            disabled={isGenerating}
            error={presetError}
            onSelect={selectPreset}
            onSave={savePreset}
            onReset={resetPreset}
            onDelete={deleteActivePreset}
          />
          <div className="space-y-2">
            <Label htmlFor="noise-type">噪声类型</Label>
            <Select value={type} onValueChange={(value) => setType(value as NoiseType)}>
              <SelectTrigger id="noise-type" aria-label="噪声类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="white">白噪声 (White)</SelectItem>
                <SelectItem value="pink">粉红噪声 (Pink)</SelectItem>
                <SelectItem value="brownian">布朗噪声 (Brownian)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="noise-amplitude">振幅 (0–1)</Label>
              <Input
                id="noise-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={amplitude}
                onChange={(event) => setAmplitude(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noise-duration">时长（秒）</Label>
              <Input
                id="noise-duration"
                type="number"
                min={1 / sampleRate}
                step="any"
                value={duration}
                readOnly={selectionActive}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · 替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)} · 时长已锁定到音频采样`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 30 秒并记住上次时长`}
          </p>
          {previewError && <p role="alert" className="text-xs text-destructive">试听失败：{previewError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              aria-pressed={isPreviewing}
              disabled={isGenerating}
              onClick={isPreviewing ? stopPreview : preview}
            >
              {isPreviewing ? '停止试听' : '试听'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? '正在生成…' : '生成噪声'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
