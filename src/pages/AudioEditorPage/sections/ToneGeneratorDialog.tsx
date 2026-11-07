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
  downloadGeneratorPreset,
  GENERATOR_PRESET_FACTORY_ID,
  GENERATOR_PRESET_FILE_MAX_BYTES,
  GeneratorPresetFileError,
  isValidGeneratorPresetSettings,
  loadGeneratorPresetStore,
  parseGeneratorPresetFile,
  saveGeneratorPresetStore,
  upsertGeneratorPreset,
  type GeneratorPreset,
  type GeneratorPresetStore,
  type TonePresetSettings,
} from '@/lib/generatorPresets';
import { generateTone, type ToneRequest, type ToneWaveform } from '@/lib/toneGenerator';
import GeneratorPresetsBar from './GeneratorPresetsBar';
import { useGeneratorPreview } from './useGeneratorPreview';

interface ToneGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  selectionActive?: boolean;
  replacementPosition?: number;
  replacementEnd?: number;
  isGenerating: boolean;
  onGenerate: (settings: ToneRequest) => void | Promise<void>;
}

export default function ToneGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  selectionActive = false,
  replacementPosition,
  replacementEnd,
  isGenerating,
  onGenerate,
}: ToneGeneratorDialogProps) {
  const [presetStore, setPresetStore] = useState(() => loadGeneratorPresetStore('tone'));
  const initialPreset = presetStore.presets.find((preset) => preset.id === presetStore.activeId)
    ?? presetStore.presets[0];
  const [waveform, setWaveform] = useState<ToneWaveform>(initialPreset.settings.waveform);
  const [frequency, setFrequency] = useState(String(initialPreset.settings.frequency));
  const [amplitude, setAmplitude] = useState(String(initialPreset.settings.amplitude));
  const [duration, setDuration] = useState('30');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const { isPreviewing, previewError, startPreview, stopPreview } = useGeneratorPreview();
  const activePreset = presetStore.presets.find((preset) => preset.id === presetStore.activeId)
    ?? presetStore.presets[0];
  const presetDirty = waveform !== activePreset.settings.waveform
    || Number(frequency) !== activePreset.settings.frequency
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
    void onGenerate({
      waveform,
      frequency: Number(frequency),
      amplitude: Number(amplitude),
      duration: Number(duration),
    });
  }

  function preview() {
    void startPreview(() => generateTone({
      waveform,
      frequency: Number(frequency),
      amplitude: Number(amplitude),
      duration: Number(duration),
      sampleRate,
    }), sampleRate);
  }

  function applyPreset(preset: GeneratorPreset<'tone'>) {
    stopPreview();
    setWaveform(preset.settings.waveform);
    setFrequency(String(preset.settings.frequency));
    setAmplitude(String(preset.settings.amplitude));
    setPresetNotice(null);
  }

  function commitPresetStore(next: GeneratorPresetStore<'tone'>): boolean {
    if (!saveGeneratorPresetStore('tone', next)) {
      setPresetError('预设保存失败：浏览器存储不可用。');
      return false;
    }
    setPresetStore(next);
    setPresetError(null);
    return true;
  }

  function selectPreset(id: string) {
    const preset = presetStore.presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    if (preset.settings.frequency > sampleRate / 2) {
      setPresetError('该预设的频率超过当前工程的奈奎斯特频率，未应用。');
      return;
    }
    if (commitPresetStore({ ...presetStore, activeId: id })) applyPreset(preset);
  }

  function savePreset(name: string): boolean {
    const settings: TonePresetSettings = {
      waveform,
      frequency: Number(frequency),
      amplitude: Number(amplitude),
    };
    if (!isValidGeneratorPresetSettings('tone', settings) || settings.frequency > sampleRate / 2) {
      setPresetError('请先输入有效的波形、频率和振幅。');
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

  async function importPreset(file: File) {
    setPresetNotice(null);
    if (file.size > GENERATOR_PRESET_FILE_MAX_BYTES) {
      setPresetError('预设文件过大，未应用。');
      return;
    }
    try {
      const settings = parseGeneratorPresetFile('tone', await file.text());
      if (settings.frequency > sampleRate / 2) {
        throw new GeneratorPresetFileError(
          'invalid',
          '预设频率超过当前工程的奈奎斯特频率，未应用。',
        );
      }
      stopPreview();
      setWaveform(settings.waveform);
      setFrequency(String(settings.frequency));
      setAmplitude(String(settings.amplitude));
      setPresetError(null);
      setPresetNotice(`已从 ${file.name || '预设文件'} 导入参数；时长未改变。`);
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : '读取预设文件失败，未应用。');
    }
  }

  function exportPreset() {
    const settings: TonePresetSettings = {
      waveform,
      frequency: Number(frequency),
      amplitude: Number(amplitude),
    };
    if (!isValidGeneratorPresetSettings('tone', settings) || settings.frequency > sampleRate / 2) {
      setPresetNotice(null);
      setPresetError('请先输入有效的波形、频率和振幅，再导出。');
      return;
    }
    try {
      downloadGeneratorPreset('tone', settings);
      setPresetError(null);
      setPresetNotice('已导出当前音调参数；时长不包含在文件中。');
    } catch (error) {
      setPresetNotice(null);
      setPresetError(error instanceof Error ? error.message : '导出预设失败。');
    }
  }

  const selectionDescription = replacementPosition !== undefined && replacementEnd !== undefined
    ? `替换选区 ${formatTime(replacementPosition)}–${formatTime(replacementEnd)}`
    : `替换选区起点 ${formatTime(replacementPosition ?? cursorPosition)}`;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成音调</DialogTitle>
          <DialogDescription>
            按 Audacity Tone 的恒定频率与振幅生成真实单声道音频片段。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <GeneratorPresetsBar
            kind="tone"
            store={presetStore}
            dirty={presetDirty}
            disabled={isGenerating}
            error={presetError}
            notice={presetNotice}
            onSelect={selectPreset}
            onSave={savePreset}
            onReset={resetPreset}
            onDelete={deleteActivePreset}
            onImport={importPreset}
            onExport={exportPreset}
          />
          <div className="space-y-2">
            <Label htmlFor="tone-waveform">波形</Label>
            <Select value={waveform} onValueChange={(value) => setWaveform(value as ToneWaveform)}>
              <SelectTrigger id="tone-waveform" aria-label="音调波形">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sine">正弦波 (Sine)</SelectItem>
                <SelectItem value="square">方波 (Square)</SelectItem>
                <SelectItem value="sawtooth">锯齿波 (Sawtooth)</SelectItem>
                <SelectItem value="squareNoAlias">无混叠方波 (Square, no alias)</SelectItem>
                <SelectItem value="triangle">三角波 (Triangle)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tone-frequency">频率 (Hz)</Label>
              <Input
                id="tone-frequency"
                type="number"
                min="1"
                max={sampleRate / 2}
                step="1"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone-amplitude">振幅 (0–1)</Label>
              <Input
                id="tone-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={amplitude}
                onChange={(event) => setAmplitude(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tone-duration">时长（秒）</Label>
            <Input
              id="tone-duration"
              type="number"
              min={1 / sampleRate}
              step="any"
              value={duration}
              readOnly={selectionActive}
              aria-readonly={selectionActive}
              onChange={(event) => setDuration(event.target.value)}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {selectionActive
              ? `采样率 ${sampleRate} Hz · ${selectionDescription} · 时长已锁定到音频采样`
              : `采样率 ${sampleRate} Hz · 插入位置 ${formatTime(cursorPosition)} · 默认 30 秒并记住上次时长 · 频率不得超过 ${sampleRate / 2} Hz`}
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
              {isGenerating ? '正在生成…' : '生成音调'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
