import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  GENERATOR_PRESET_FACTORY_ID,
  type GeneratorPresetKind,
  type GeneratorPresetStore,
} from '@/lib/generatorPresets';

interface GeneratorPresetsBarProps<K extends GeneratorPresetKind> {
  kind: K;
  store: GeneratorPresetStore<K>;
  dirty: boolean;
  disabled?: boolean;
  error?: string | null;
  notice?: string | null;
  onSelect: (id: string) => void;
  onSave: (name: string) => boolean;
  onReset: () => void;
  onDelete: () => void;
  onImport: (file: File) => void | Promise<void>;
  onExport: () => void;
}

export default function GeneratorPresetsBar<K extends GeneratorPresetKind>({
  kind,
  store,
  dirty,
  disabled = false,
  error,
  notice,
  onSelect,
  onSave,
  onReset,
  onDelete,
  onImport,
  onExport,
}: GeneratorPresetsBarProps<K>) {
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const label = kind === 'tone' ? '音调预设' : '噪声预设';
  const active = store.presets.find((preset) => preset.id === store.activeId)
    ?? store.presets[0];
  const controlsDisabled = disabled || importing;

  function save() {
    if (onSave(name)) {
      setName('');
      setSaving(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={`${kind}-preset`}>{label}</Label>
          <select
            id={`${kind}-preset`}
            aria-label={label}
            className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/20 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
            value={store.activeId}
            disabled={controlsDisabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {store.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={controlsDisabled} onClick={() => setSaving((value) => !value)}>
          保存预设
        </Button>
        <Button type="button" variant="outline" disabled={controlsDisabled} onClick={onReset}>重置</Button>
        <Button
          type="button"
          variant="outline"
          disabled={controlsDisabled || active?.id === GENERATOR_PRESET_FACTORY_ID}
          onClick={onDelete}
        >
          删除
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="预设选项"
              disabled={controlsDisabled}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
              导入预设…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>导出预设</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,text/plain"
          aria-label={`${label}文件`}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void importFile(file);
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {dirty ? '当前参数有未保存修改；重置可恢复所选预设。' : `当前：${active?.name ?? label}。时长独立记忆，不随预设覆盖。`}
      </p>
      {saving && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor={`${kind}-preset-name`}>预设名称</Label>
            <Input
              id={`${kind}-preset-name`}
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  save();
                }
              }}
            />
          </div>
          <Button type="button" onClick={save}>确认保存</Button>
          <Button type="button" variant="secondary" onClick={() => setSaving(false)}>取消保存</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}
