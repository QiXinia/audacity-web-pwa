import { useState } from 'react';
import { Button } from '@/components/ui/button';
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
  onSelect: (id: string) => void;
  onSave: (name: string) => boolean;
  onReset: () => void;
  onDelete: () => void;
}

export default function GeneratorPresetsBar<K extends GeneratorPresetKind>({
  kind,
  store,
  dirty,
  disabled = false,
  error,
  onSelect,
  onSave,
  onReset,
  onDelete,
}: GeneratorPresetsBarProps<K>) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const label = kind === 'tone' ? '音调预设' : '噪声预设';
  const active = store.presets.find((preset) => preset.id === store.activeId)
    ?? store.presets[0];

  function save() {
    if (onSave(name)) {
      setName('');
      setSaving(false);
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
            disabled={disabled}
            onChange={(event) => onSelect(event.target.value)}
          >
            {store.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => setSaving((value) => !value)}>
          保存预设
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={onReset}>重置</Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || active?.id === GENERATOR_PRESET_FACTORY_ID}
          onClick={onDelete}
        >
          删除
        </Button>
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
    </div>
  );
}
