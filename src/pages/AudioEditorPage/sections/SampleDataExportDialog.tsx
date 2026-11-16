import { useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS,
  getSampleDataFileFormat,
  validateSampleDataExportSettings,
  type SampleDataChannelLayout,
  type SampleDataExportFile,
  type SampleDataExportSettings,
  type SampleDataHeader,
  type SampleDataIndex,
  type SampleDataMessages,
  type SampleDataUnits,
} from '@/lib/sampleDataExport';

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none hover:border-ring focus:border-ring disabled:cursor-not-allowed disabled:opacity-50';

function SelectField({
  id,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={SELECT_CLASS} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

export default function SampleDataExportDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  isExporting,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  isExporting: boolean;
  onExport: (settings: SampleDataExportSettings) => Promise<SampleDataExportFile>;
}) {
  const [settings, setSettings] = useState<SampleDataExportSettings>({ ...DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS });
  const [exportError, setExportError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<SampleDataExportFile | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettings({ ...DEFAULT_SAMPLE_DATA_EXPORT_SETTINGS });
    setExportError(null);
    setCompletion(null);
  }, [open]);

  const format = getSampleDataFileFormat(settings.filename);
  let validationError: string | null = null;
  try {
    validateSampleDataExportSettings(settings);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  function update<K extends keyof SampleDataExportSettings>(key: K, value: SampleDataExportSettings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
    setCompletion(null);
  }

  async function exportData(): Promise<void> {
    if (validationError || isExporting) return;
    setExportError(null);
    setCompletion(null);
    try {
      const result = await onExport(settings);
      if (settings.messages === 'yes') setCompletion(result);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isExporting) onOpenChange(next); }}>
      <DialogContent data-testid="sample-data-export-dialog" className="max-h-[92vh] max-w-[620px] gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Sample Data Export</DialogTitle>
          <DialogDescription>
            Export selected audio samples to a text, CSV or HTML file. 导出过程不会修改工程或新增撤销历史。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <p className="text-xs text-muted-foreground">
            选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒。每次导出一条目标音轨；显式多选多条轨道时会给出诊断。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sample-data-limit">Limit output to first (samples)</Label>
              <Input
                id="sample-data-limit"
                type="number"
                min={1}
                max={1000000}
                step={1}
                value={Number.isFinite(settings.sampleLimit) ? settings.sampleLimit : ''}
                disabled={isExporting}
                onChange={(event) => update('sampleLimit', event.target.value === '' ? Number.NaN : event.target.valueAsNumber)}
              />
            </div>
            <SelectField
              id="sample-data-units"
              label="Measurement scale"
              value={settings.units}
              disabled={isExporting || format === 'html'}
              onChange={(value) => update('units', value as SampleDataUnits)}
            >
              <option value="db">dB</option>
              <option value="linear">Linear</option>
            </SelectField>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-data-filename">Export data to (filename)</Label>
            <Input
              id="sample-data-filename"
              value={settings.filename}
              disabled={isExporting}
              spellCheck={false}
              onChange={(event) => update('filename', event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              扩展名决定输出：{format.toUpperCase()}。浏览器通过下载保存；文件名不能包含路径。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="sample-data-index"
              label="Index (text files only)"
              value={settings.index}
              disabled={isExporting || format !== 'txt'}
              onChange={(value) => update('index', value as SampleDataIndex)}
            >
              <option value="none">None</option>
              <option value="count">Sample Count</option>
              <option value="time">Time Indexed</option>
            </SelectField>
            <SelectField
              id="sample-data-header"
              label="Include header information"
              value={settings.header}
              disabled={isExporting || format === 'html'}
              onChange={(value) => update('header', value as SampleDataHeader)}
            >
              <option value="none">None</option>
              <option value="minimal">Minimal</option>
              <option value="standard">Standard</option>
              <option value="all">All</option>
            </SelectField>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-data-optional">Optional header text</Label>
            <textarea
              id="sample-data-optional"
              className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none hover:border-ring focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
              value={settings.optionalText}
              disabled={isExporting}
              onChange={(event) => update('optionalText', event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="sample-data-layout"
              label="Channel layout for stereo"
              value={settings.channelLayout}
              disabled={isExporting || format === 'html'}
              onChange={(value) => update('channelLayout', value as SampleDataChannelLayout)}
            >
              <option value="same-line">L-R on Same Line</option>
              <option value="alternate">Alternate Lines</option>
              <option value="left-first">L Channel First</option>
            </SelectField>
            <SelectField
              id="sample-data-messages"
              label="Show messages"
              value={settings.messages}
              disabled={isExporting}
              onChange={(value) => update('messages', value as SampleDataMessages)}
            >
              <option value="yes">Yes</option>
              <option value="errors">Errors Only</option>
              <option value="none">None</option>
            </SelectField>
          </div>

          {format === 'html' && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              HTML 按官方插件固定输出完整统计，以及每个采样的线性值和 dB 值；文本索引、标头和声道布局选择不适用。
            </p>
          )}
          {(validationError || exportError) && <p role="alert" className="text-xs text-destructive">{validationError ?? exportError}</p>}
          {completion && (
            <p role="status" className="rounded-md border border-green-700/40 bg-green-700/10 px-3 py-2 text-xs">
              Data written to: {completion.filename}（{completion.sampleCount} samples，{completion.channelCount === 2 ? 'stereo' : 'mono'}）
            </p>
          )}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={isExporting} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={Boolean(validationError) || isExporting} onClick={() => { void exportData(); }}>
            <Download className="mr-1 h-4 w-4" />{isExporting ? '导出中…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
