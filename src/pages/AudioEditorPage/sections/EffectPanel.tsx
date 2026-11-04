import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Trash2,
  Power,
  GripVertical,
  Volume2,
  Sliders,
  Waves,
  BarChart3,
  Speaker,
  Wind,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ITrack, IEffect, EffectType } from '@/types/project';

interface EffectPanelProps {
  track: ITrack;
  onClose: () => void;
  onAddEffect: (type: EffectType) => void;
  onUpdateEffect: (effectId: string, params: Record<string, number>) => void;
  onToggleBypass: (effectId: string) => void;
  onRemoveEffect: (effectId: string) => void;
}

const EFFECT_CATALOG: Array<{
  type: EffectType;
  label: string;
  icon: React.ReactNode;
  description: string;
  defaultParams: Record<string, number>;
  paramDefs: Array<{
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
  }>;
}> = [
  {
    type: 'gain',
    label: '增益',
    icon: <Volume2 className="size-4" />,
    description: '调整轨道音量大小',
    defaultParams: { gain: 0 },
    paramDefs: [
      { key: 'gain', label: '增益量', min: -60, max: 24, step: 0.5, unit: 'dB' },
    ],
  },
  {
    type: 'highPass',
    label: '高通滤波',
    icon: <Waves className="size-4" />,
    description: '去除低频部分',
    defaultParams: { cutoff: 80, q: 0.707 },
    paramDefs: [
      { key: 'cutoff', label: '截止频率', min: 20, max: 20000, step: 1, unit: 'Hz' },
      { key: 'q', label: 'Q值', min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    type: 'lowPass',
    label: '低通滤波',
    icon: <BarChart3 className="size-4" />,
    description: '去除高频部分',
    defaultParams: { cutoff: 8000, q: 0.707 },
    paramDefs: [
      { key: 'cutoff', label: '截止频率', min: 20, max: 20000, step: 1, unit: 'Hz' },
      { key: 'q', label: 'Q值', min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    type: 'compressor',
    label: '压缩器',
    icon: <Sliders className="size-4" />,
    description: '动态范围压缩',
    defaultParams: { threshold: -24, ratio: 4, attack: 0.01, release: 0.25, makeup: 0 },
    paramDefs: [
      { key: 'threshold', label: '阈值', min: -60, max: 0, step: 0.5, unit: 'dB' },
      { key: 'ratio', label: '压缩比', min: 1, max: 20, step: 0.5, unit: ':1' },
      { key: 'attack', label: '启动', min: 0.001, max: 0.5, step: 0.001, unit: 's' },
      { key: 'release', label: '释放', min: 0.01, max: 2, step: 0.01, unit: 's' },
      { key: 'makeup', label: '补偿', min: -24, max: 24, step: 0.5, unit: 'dB' },
    ],
  },
  {
    type: 'eq',
    label: '均衡器',
    icon: <Speaker className="size-4" />,
    description: '三频段均衡器',
    defaultParams: { low: 0, mid: 0, high: 0 },
    paramDefs: [
      { key: 'low', label: '低频', min: -12, max: 12, step: 0.5, unit: 'dB' },
      { key: 'mid', label: '中频', min: -12, max: 12, step: 0.5, unit: 'dB' },
      { key: 'high', label: '高频', min: -12, max: 12, step: 0.5, unit: 'dB' },
    ],
  },
  {
    type: 'reverb',
    label: '混响',
    icon: <Wind className="size-4" />,
    description: '添加空间感混响',
    defaultParams: { decay: 2, wet: 0.3, predelay: 0.02 },
    paramDefs: [
      { key: 'decay', label: '衰减时间', min: 0.1, max: 10, step: 0.1, unit: 's' },
      { key: 'wet', label: '湿信号', min: 0, max: 1, step: 0.01 },
      { key: 'predelay', label: '预延迟', min: 0, max: 0.2, step: 0.001, unit: 's' },
    ],
  },
  {
    type: 'delay',
    label: '延迟',
    icon: <Zap className="size-4" />,
    description: '回声/延迟效果',
    defaultParams: { time: 0.3, feedback: 0.4, wet: 0.3 },
    paramDefs: [
      { key: 'time', label: '延迟时间', min: 0.01, max: 2, step: 0.01, unit: 's' },
      { key: 'feedback', label: '反馈量', min: 0, max: 0.95, step: 0.01 },
      { key: 'wet', label: '湿信号', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    type: 'noiseGate',
    label: '噪声门',
    icon: <Zap className="size-4" />,
    description: '低于阈值时静音',
    defaultParams: { threshold: -40, attack: 0.005, release: 0.1, hold: 0.05 },
    paramDefs: [
      { key: 'threshold', label: '阈值', min: -80, max: -20, step: 1, unit: 'dB' },
      { key: 'attack', label: '启动', min: 0.001, max: 0.1, step: 0.001, unit: 's' },
      { key: 'release', label: '释放', min: 0.01, max: 1, step: 0.01, unit: 's' },
      { key: 'hold', label: '保持', min: 0, max: 0.5, step: 0.01, unit: 's' },
    ],
  },
];

export default function EffectPanel({
  track,
  onClose,
  onAddEffect,
  onUpdateEffect,
  onToggleBypass,
  onRemoveEffect,
}: EffectPanelProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(
    track.effects[0]?.id ?? null,
  );

  const activeEffects = useMemo(() => {
    return track.effects;
  }, [track.effects]);

  const selectedEffect = useMemo(() => {
    return activeEffects.find((e) => e.id === selectedEffectId);
  }, [activeEffects, selectedEffectId]);

  const effectDef = useMemo(() => {
    if (!selectedEffect) return null;
    return EFFECT_CATALOG.find((e) => e.type === selectedEffect.type) ?? null;
  }, [selectedEffect]);

  function getEffectLabel(type: EffectType): string {
    return EFFECT_CATALOG.find((e) => e.type === type)?.label || type;
  }

  function handleParamChange(key: string, value: number) {
    if (!selectedEffect) return;
    const newParams = { ...selectedEffect.params, [key]: value };
    onUpdateEffect(selectedEffect.id, newParams);
  }

  return (
    <TooltipProvider>
      <div className="flex w-72 shrink-0 flex-col border-l border-border bg-card/30">
        {/* Header */}
        <div className="flex h-9 items-center justify-between border-b border-border px-2">
          <span className="text-xs font-medium">效果器 - {track.name}</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Add Effect Button */}
        <div className="border-b border-border p-2">
          {!showAddMenu ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => setShowAddMenu(true)}
            >
              <Plus className="mr-1 size-3.5" />
              添加效果
            </Button>
          ) : (
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">选择效果类型</div>
              <div className="grid grid-cols-2 gap-1">
                {EFFECT_CATALOG.map((fx) => (
                  <Button
                    key={fx.type}
                    variant="outline"
                    size="sm"
                    className="h-auto flex-col gap-1 py-2 text-[10px]"
                    onClick={() => {
                      onAddEffect(fx.type);
                      setShowAddMenu(false);
                    }}
                  >
                    {fx.icon}
                    {fx.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAddMenu(false)}
              >
                取消
              </Button>
            </div>
          )}
        </div>

        {/* Effect Chain */}
        <div className="flex-1 overflow-y-auto p-2">
          {activeEffects.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              <div className="mb-2">暂无效果器</div>
              <div className="text-[10px]">点击上方按钮添加音频效果</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeEffects.map((effect, index) => (
                <EffectChainItem
                  key={effect.id}
                  effect={effect}
                  index={index}
                  label={getEffectLabel(effect.type)}
                  isSelected={selectedEffectId === effect.id}
                  onSelect={() => setSelectedEffectId(effect.id)}
                  onToggleBypass={() => onToggleBypass(effect.id)}
                  onRemove={() => onRemoveEffect(effect.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Effect Parameters */}
        <AnimatePresence>
          {selectedEffect && effectDef && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="shrink-0 overflow-hidden border-t border-border"
            >
              <div className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {effectDef.icon}
                    <span className="text-sm font-medium">{effectDef.label}</span>
                  </div>
                  <Badge variant={selectedEffect.bypassed ? 'outline' : 'secondary'} className="text-[10px]">
                    {selectedEffect.bypassed ? '已旁路' : '启用中'}
                  </Badge>
                </div>

                <p className="mb-3 text-[10px] text-muted-foreground">
                  {effectDef.description}
                </p>

                <div className="space-y-3">
                  {effectDef.paramDefs.map((param) => {
                    const value = selectedEffect.params[param.key] ?? 0;
                    return (
                      <div key={param.key}>
                        <div className="mb-1 flex justify-between text-[10px]">
                          <Label>{param.label}</Label>
                          <span className="tabular-nums text-muted-foreground">
                            {value.toFixed(param.step < 1 ? 2 : 0)}
                            {param.unit || ''}
                          </span>
                        </div>
                        <Slider
                          value={[value]}
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          onValueChange={(v) => handleParamChange(param.key, v[0])}
                          className="h-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}

function EffectChainItem({
  effect,
  index,
  label,
  isSelected,
  onSelect,
  onToggleBypass,
  onRemove,
}: {
  effect: IEffect;
  index: number;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onToggleBypass: () => void;
  onRemove: () => void;
}) {
  const icon = EFFECT_CATALOG.find((e) => e.type === effect.type)?.icon ?? <Sliders className="size-3.5" />;

  return (
    <div
      className={`group flex items-center gap-1.5 rounded-md border p-1.5 transition-colors cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border/50 hover:border-border bg-background/50'
      } ${effect.bypassed ? 'opacity-50' : ''}`}
      onClick={onSelect}
    >
      <GripVertical className="size-3 text-muted-foreground/50" />
      <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground">#{index + 1}</div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-70 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBypass();
            }}
          >
            <Power className={`size-3 ${effect.bypassed ? 'text-muted-foreground' : 'text-primary'}`} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{effect.bypassed ? '启用' : '旁路'}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive opacity-70 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>移除</TooltipContent>
      </Tooltip>
    </div>
  );
}
