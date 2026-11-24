import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Trash2,
  Power,
  PowerOff,
  GripVertical,
  Volume2,
  Sliders,
  Waves,
  BarChart3,
  Speaker,
  Wind,
  Zap,
  ArrowUp,
  ArrowDown,
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
  onAddEffect: (type: EffectType) => IEffect | null | void | Promise<IEffect | null | void>;
  onUpdateEffect: (effectId: string, params: Record<string, number>) => void;
  onToggleBypass: (effectId: string) => void | Promise<void>;
  onToggleAllEffects?: (trackId: string, active: boolean) => void | Promise<void>;
  onRemoveEffect: (effectId: string) => void | Promise<void>;
  onMoveEffect: (effectId: string, toIndex: number) => void | Promise<void>;
  onReplaceEffect: (effectId: string, type: EffectType) => IEffect | null | void | Promise<IEffect | null | void>;
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
    defaultParams: { frequency: 80, q: 0.707 },
    paramDefs: [
      { key: 'frequency', label: '截止频率', min: 20, max: 20000, step: 1, unit: 'Hz' },
      { key: 'q', label: 'Q值', min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    type: 'lowPass',
    label: '低通滤波',
    icon: <BarChart3 className="size-4" />,
    description: '去除高频部分',
    defaultParams: { frequency: 8000, q: 0.707 },
    paramDefs: [
      { key: 'frequency', label: '截止频率', min: 20, max: 20000, step: 1, unit: 'Hz' },
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
  onToggleAllEffects,
  onRemoveEffect,
  onMoveEffect,
  onReplaceEffect,
}: EffectPanelProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(
    track.effects[0]?.id ?? null,
  );
  const [isMovingEffect, setIsMovingEffect] = useState(false);
  const effectMoveInFlight = useRef(false);
  const explicitSelectionRevision = useRef(0);
  const trackRevision = useRef(0);
  const effectChainRevision = useRef(0);
  const latestTrackEffects = useRef(track.effects);
  latestTrackEffects.current = track.effects;
  const gripElements = useRef(new Map<string, HTMLButtonElement>());
  const effectNameElements = useRef(new Map<string, HTMLButtonElement>());
  const bypassElements = useRef(new Map<string, HTMLButtonElement>());
  const toggleAllEffectsButton = useRef<HTMLButtonElement>(null);
  const pendingBypassFocus = useRef<{
    trackId: string;
    effectId: string;
    operationIsCurrent?: () => boolean;
  } | null>(null);
  const pendingToggleAllEffectsFocus = useRef<{
    trackId: string;
    operationIsCurrent: () => boolean;
  } | null>(null);
  const pendingGripFocus = useRef<{
    trackId: string;
    effectId: string;
    operationIsCurrent?: () => boolean;
  } | null>(null);
  const pendingEffectFocus = useRef<{
    trackId: string;
    effectId: string;
    operationIsCurrent?: () => boolean;
  } | null>(null);
  const pendingRemovalFocus = useRef<{
    trackId: string;
    effectId: string;
    index: number;
    effectIds: string[];
    operationIsCurrent: () => boolean;
  } | null>(null);
  const addEffectButton = useRef<HTMLButtonElement>(null);
  const addEffectOptions = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreAddEffectButtonFocus = useRef<{
    trackId: string;
    operationIsCurrent?: () => boolean;
  } | null>(null);
  const parameterPanel = useRef<HTMLDivElement>(null);
  const pendingParameterFocus = useRef<{
    trackId: string;
    effectId: string;
    operationIsCurrent?: () => boolean;
  } | null>(null);

  useEffect(() => {
    // Audacity resets the effect model when the selected track changes. An operation
    // completed during another track's visit must not select its old result on return.
    trackRevision.current += 1;
  }, [track.id]);

  useEffect(() => {
    // Audacity also rebuilds changed effect-stack entries after undo/redo. If the same
    // track's chain changed while saving, an old UI completion no longer owns selection.
    effectChainRevision.current += 1;
  }, [track.effects]);

  function createFocusOperationGuard(expectedEffects?: IEffect[]) {
    const selectionRevision = explicitSelectionRevision.current;
    const operationTrackRevision = trackRevision.current;
    const operationEffectChainRevision = effectChainRevision.current;
    return () => {
      if (
        selectionRevision !== explicitSelectionRevision.current
        || operationTrackRevision !== trackRevision.current
      ) return false;
      if (operationEffectChainRevision === effectChainRevision.current) return true;
      // A successful mutation may legitimately commit its own new chain. Anything other
      // than that exact expected chain is an external undo/redo or cross-tab update.
      return expectedEffects !== undefined
        && latestTrackEffects.current.length === expectedEffects.length
        && latestTrackEffects.current.every((effect, index) => {
          const expected = expectedEffects[index];
          if (expected === undefined) return false;
          const actualParamKeys = Object.keys(effect.params);
          const expectedParamKeys = Object.keys(expected.params);
          return effect.id === expected.id
            && effect.type === expected.type
            && effect.bypassed === expected.bypassed
            && actualParamKeys.length === expectedParamKeys.length
            && expectedParamKeys.every((key) => Object.is(effect.params[key], expected.params[key]));
        });
    };
  }

  async function handleMoveEffect(effectId: string, toIndex: number, restoreGripFocus = false) {
    if (effectMoveInFlight.current) return;
    const fromIndex = track.effects.findIndex((effect) => effect.id === effectId);
    if (
      fromIndex < 0
      || !Number.isInteger(toIndex)
      || toIndex < 0
      || toIndex >= track.effects.length
      || toIndex === fromIndex
    ) return;
    const expectedEffects = [...track.effects];
    const [movedEffect] = expectedEffects.splice(fromIndex, 1);
    expectedEffects.splice(toIndex, 0, movedEffect!);
    const operationIsCurrent = createFocusOperationGuard(expectedEffects);
    if (restoreGripFocus) {
      pendingGripFocus.current = { trackId: track.id, effectId, operationIsCurrent };
    } else {
      pendingEffectFocus.current = { trackId: track.id, effectId, operationIsCurrent };
    }
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      await onMoveEffect(effectId, toIndex);
    } catch {
      // Mutation callbacks report their own save errors; keep only a current restoration.
    } finally {
      if (!operationIsCurrent()) {
        if (restoreGripFocus && pendingGripFocus.current?.trackId === track.id) {
          pendingGripFocus.current = null;
        } else if (!restoreGripFocus && pendingEffectFocus.current?.trackId === track.id) {
          pendingEffectFocus.current = null;
        }
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  async function handleReplaceEffect(effectId: string, type: EffectType) {
    if (effectMoveInFlight.current) return;
    const operationIsCurrent = createFocusOperationGuard();
    // Queue fallback restoration before awaiting so an explicit selection can cancel it.
    pendingEffectFocus.current = { trackId: track.id, effectId, operationIsCurrent };
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      const replacement = await onReplaceEffect(effectId, type);
      if (replacement) {
        pendingEffectFocus.current = null;
        if (operationIsCurrent()) {
          const expectedEffects = latestTrackEffects.current.map((effect) => (
            effect.id === effectId ? replacement : effect
          ));
          pendingParameterFocus.current = {
            trackId: track.id,
            effectId: replacement.id,
            operationIsCurrent: createFocusOperationGuard(expectedEffects),
          };
          setSelectedEffectId(replacement.id);
        }
      }
    } catch {
      // Mutation callbacks report their own save errors; keep only an uncancelled restoration.
    } finally {
      // Empty results and failures must not restore focus into a chain replaced externally.
      if (!operationIsCurrent() && pendingEffectFocus.current?.trackId === track.id) {
        pendingEffectFocus.current = null;
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  async function handleAddEffect(type: EffectType) {
    if (effectMoveInFlight.current) return;
    const operationIsCurrent = createFocusOperationGuard();
    // Queue restoration before awaiting so a newer explicit selection can cancel it.
    restoreAddEffectButtonFocus.current = { trackId: track.id, operationIsCurrent };
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      const added = await onAddEffect(type);
      if (added) {
        restoreAddEffectButtonFocus.current = null;
        if (operationIsCurrent()) {
          const expectedEffects = [...latestTrackEffects.current, added];
          pendingParameterFocus.current = {
            trackId: track.id,
            effectId: added.id,
            operationIsCurrent: createFocusOperationGuard(expectedEffects),
          };
          setSelectedEffectId(added.id);
        }
      }
      setShowAddMenu(false);
    } catch {
      setShowAddMenu(false);
    } finally {
      // Preserve normal empty/failure restoration only while the original chain is current.
      if (!operationIsCurrent() && restoreAddEffectButtonFocus.current?.trackId === track.id) {
        restoreAddEffectButtonFocus.current = null;
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  function closeAddMenu() {
    restoreAddEffectButtonFocus.current = { trackId: track.id };
    setShowAddMenu(false);
  }

  async function handleToggleBypass(effectId: string) {
    if (effectMoveInFlight.current) return;
    const expectedEffects = track.effects.map((effect) => (
      effect.id === effectId ? { ...effect, bypassed: !effect.bypassed } : effect
    ));
    const operationIsCurrent = createFocusOperationGuard(expectedEffects);
    pendingBypassFocus.current = { trackId: track.id, effectId, operationIsCurrent };
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      await onToggleBypass(effectId);
    } catch {
      // Mutation callbacks report their own save errors; keep only a current restoration.
    } finally {
      if (!operationIsCurrent() && pendingBypassFocus.current?.trackId === track.id) {
        pendingBypassFocus.current = null;
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  async function handleToggleAllEffects() {
    if (effectMoveInFlight.current || !onToggleAllEffects) return;
    // This command changes only effectsActive; any effect-chain revision is external.
    const operationIsCurrent = createFocusOperationGuard();
    pendingToggleAllEffectsFocus.current = { trackId: track.id, operationIsCurrent };
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      await onToggleAllEffects(track.id, !(track.effectsActive ?? true));
    } catch {
      // Mutation callbacks report their own save errors; keep only a current restoration.
    } finally {
      if (!operationIsCurrent() && pendingToggleAllEffectsFocus.current?.trackId === track.id) {
        pendingToggleAllEffectsFocus.current = null;
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  async function handleRemoveEffect(effectId: string) {
    if (effectMoveInFlight.current) return;
    const index = track.effects.findIndex((effect) => effect.id === effectId);
    if (index < 0) return;
    const expectedEffects = track.effects.filter((effect) => effect.id !== effectId);
    const operationIsCurrent = createFocusOperationGuard(expectedEffects);
    pendingRemovalFocus.current = {
      trackId: track.id,
      effectId,
      index,
      effectIds: track.effects.map((effect) => effect.id),
      operationIsCurrent,
    };
    effectMoveInFlight.current = true;
    setIsMovingEffect(true);
    try {
      await onRemoveEffect(effectId);
    } catch {
      // Mutation callbacks report their own save errors; a current operation may still restore focus.
    } finally {
      if (!operationIsCurrent() && pendingRemovalFocus.current?.trackId === track.id) {
        pendingRemovalFocus.current = null;
      }
      effectMoveInFlight.current = false;
      setIsMovingEffect(false);
    }
  }

  const effectsActive = track.effectsActive ?? true;

  const activeEffects = useMemo(() => {
    return track.effects;
  }, [track.effects]);

  useEffect(() => {
    if (showAddMenu) {
      addEffectOptions.current[0]?.focus();
      return;
    }
    const pending = restoreAddEffectButtonFocus.current;
    if (!pending) return;
    restoreAddEffectButtonFocus.current = null;
    if (
      pending.trackId === track.id
      && (pending.operationIsCurrent === undefined || pending.operationIsCurrent())
    ) {
      addEffectButton.current?.focus();
    }
  }, [showAddMenu, track.id]);

  useEffect(() => {
    const pending = pendingGripFocus.current;
    if (!pending || isMovingEffect) return;
    if (
      pending.trackId !== track.id
      || (pending.operationIsCurrent !== undefined && !pending.operationIsCurrent())
    ) {
      pendingGripFocus.current = null;
      return;
    }
    pendingGripFocus.current = null;
    gripElements.current.get(pending.effectId)?.focus();
  }, [activeEffects, isMovingEffect, track.id]);

  useEffect(() => {
    const pending = pendingEffectFocus.current;
    if (!pending || isMovingEffect) return;
    if (
      pending.trackId !== track.id
      || (pending.operationIsCurrent !== undefined && !pending.operationIsCurrent())
    ) {
      pendingEffectFocus.current = null;
      return;
    }
    const effectName = effectNameElements.current.get(pending.effectId);
    if (!effectName) {
      pendingEffectFocus.current = null;
      return;
    }
    pendingEffectFocus.current = null;
    effectName.focus();
  }, [activeEffects, isMovingEffect, track.id]);

  useEffect(() => {
    const pending = pendingBypassFocus.current;
    if (!pending || isMovingEffect) return;
    if (
      pending.trackId !== track.id
      || (pending.operationIsCurrent !== undefined && !pending.operationIsCurrent())
    ) {
      pendingBypassFocus.current = null;
      return;
    }
    const bypass = bypassElements.current.get(pending.effectId);
    // Bypassing never recreates a missing effect, so do not retain a stale focus request.
    pendingBypassFocus.current = null;
    bypass?.focus();
  }, [activeEffects, isMovingEffect, track.id]);

  useEffect(() => {
    const pending = pendingToggleAllEffectsFocus.current;
    if (!pending || isMovingEffect) return;
    pendingToggleAllEffectsFocus.current = null;
    if (pending.trackId === track.id && pending.operationIsCurrent()) {
      toggleAllEffectsButton.current?.focus();
    }
  }, [isMovingEffect, track.id]);

  useEffect(() => {
    const pending = pendingRemovalFocus.current;
    if (!pending || isMovingEffect) return;
    if (pending.trackId !== track.id || !pending.operationIsCurrent()) {
      pendingRemovalFocus.current = null;
      return;
    }

    const currentEffectIds = activeEffects.map((effect) => effect.id);
    const hasSameEffectIds = (expected: string[]) => (
      currentEffectIds.length === expected.length
      && currentEffectIds.every((effectId, index) => effectId === expected[index])
    );
    const isUnchanged = hasSameEffectIds(pending.effectIds);
    const isOwnRemoval = hasSameEffectIds(pending.effectIds.filter((effectId) => effectId !== pending.effectId));
    // Undo/redo or another tab can replace the chain while this command is pending.
    // Only consume the request for an unchanged chain or exactly its own removal.
    if (!isUnchanged && !isOwnRemoval) {
      pendingRemovalFocus.current = null;
      return;
    }

    const removedEffect = activeEffects.find((effect) => effect.id === pending.effectId);
    if (removedEffect) {
      const originalEffectName = effectNameElements.current.get(removedEffect.id);
      if (!originalEffectName) return;
      pendingRemovalFocus.current = null;
      originalEffectName.focus();
      return;
    }

    const targetEffect = activeEffects[Math.min(pending.index, activeEffects.length - 1)];
    if (!targetEffect) {
      pendingRemovalFocus.current = null;
      addEffectButton.current?.focus();
      return;
    }

    const targetEffectName = effectNameElements.current.get(targetEffect.id);
    if (!targetEffectName) return;
    pendingRemovalFocus.current = null;
    targetEffectName.focus();
  }, [activeEffects, isMovingEffect, track.id]);

  const resolvedSelectedEffectId = activeEffects.some((effect) => effect.id === selectedEffectId)
    ? selectedEffectId
    : activeEffects[0]?.id ?? null;

  const selectedEffect = useMemo(() => {
    return activeEffects.find((effect) => effect.id === resolvedSelectedEffectId);
  }, [activeEffects, resolvedSelectedEffectId]);

  const effectDef = useMemo(() => {
    if (!selectedEffect) return null;
    return EFFECT_CATALOG.find((e) => e.type === selectedEffect.type) ?? null;
  }, [selectedEffect]);

  useEffect(() => {
    const pending = pendingParameterFocus.current;
    if (!pending || isMovingEffect) return;
    if (
      pending.trackId !== track.id
      || (pending.operationIsCurrent !== undefined && !pending.operationIsCurrent())
    ) {
      pendingParameterFocus.current = null;
      // The operation may have selected its result just before an external chain render.
      // Do not let that stale selection reappear if the service commits its result later.
      setSelectedEffectId((current) => current === pending.effectId ? null : current);
      return;
    }
    if (resolvedSelectedEffectId !== pending.effectId) return;
    const firstSlider = parameterPanel.current?.querySelector<HTMLElement>('[role="slider"]');
    if (!firstSlider) return;
    pendingParameterFocus.current = null;
    firstSlider.focus();
  }, [activeEffects, effectDef, isMovingEffect, resolvedSelectedEffectId, track.id]);

  function getEffectLabel(type: EffectType): string {
    return EFFECT_CATALOG.find((e) => e.type === type)?.label || type;
  }

  function handleSelectEffect(effectId: string) {
    // A newer explicit selection supersedes queued operation selection and focus restoration.
    explicitSelectionRevision.current += 1;
    pendingParameterFocus.current = null;
    pendingRemovalFocus.current = null;
    pendingEffectFocus.current = null;
    pendingGripFocus.current = null;
    pendingBypassFocus.current = null;
    pendingToggleAllEffectsFocus.current = null;
    restoreAddEffectButtonFocus.current = null;
    setSelectedEffectId(effectId);
  }

  function handleParamChange(key: string, value: number) {
    if (!selectedEffect) return;
    onUpdateEffect(selectedEffect.id, { [key]: value });
  }

  return (
    <TooltipProvider>
      <div className="flex w-72 shrink-0 flex-col border-l border-border bg-card/30">
        {/* Header */}
        <div className="flex h-9 items-center justify-between border-b border-border px-2">
          <span className="text-xs font-medium">效果器 - {track.name}</span>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={toggleAllEffectsButton}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`size-7 ${effectsActive ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-label="切换全部效果"
                  aria-pressed={effectsActive}
                  title="切换全部效果；保留各效果自己的旁路状态"
                  disabled={isMovingEffect || !onToggleAllEffects}
                  onClick={() => void handleToggleAllEffects()}
                >
                  {effectsActive ? <Power className="size-4" /> : <PowerOff className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{effectsActive ? '关闭全部实时效果' : '启用全部实时效果'}</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Add Effect Button */}
        <div className="border-b border-border p-2">
          {!showAddMenu ? (
            <Button
              ref={addEffectButton}
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => setShowAddMenu(true)}
              disabled={isMovingEffect}
            >
              <Plus className="mr-1 size-3.5" />
              添加效果
            </Button>
          ) : (
            <div
              className="space-y-1"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  closeAddMenu();
                  return;
                }

                const options = addEffectOptions.current.filter(
                  (option): option is HTMLButtonElement => option !== null,
                );
                const currentIndex = options.indexOf(event.target as HTMLButtonElement);
                if (currentIndex < 0) return;

                let nextIndex: number | null = null;
                if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
                if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = options.length - 1;
                if (nextIndex === null) return;

                event.preventDefault();
                event.stopPropagation();
                options[nextIndex]?.focus();
              }}
            >
              <div className="text-[10px] font-medium text-muted-foreground">选择效果类型</div>
              <div className="grid grid-cols-2 gap-1">
                {EFFECT_CATALOG.map((fx, effectIndex) => (
                  <Button
                    ref={(node) => {
                      addEffectOptions.current[effectIndex] = node;
                    }}
                    key={fx.type}
                    variant="outline"
                    size="sm"
                    className="h-auto flex-col gap-1 py-2 text-[10px]"
                    disabled={isMovingEffect}
                    onClick={() => void handleAddEffect(fx.type)}
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
                onClick={closeAddMenu}
                disabled={isMovingEffect}
              >
                取消
              </Button>
            </div>
          )}
        </div>

        {/* Effect Chain */}
        <div className="flex-1 overflow-y-auto p-2">
          {activeEffects.length === 0 ? (
            <div className="space-y-4 px-2 py-8 text-xs text-muted-foreground">
              <div className="text-center">
                <div className="mb-2">暂无效果器</div>
                <div className="text-[10px]">点击上方按钮添加音频效果</div>
              </div>
              <p className="text-[11px] leading-5 text-foreground/80">
                实时效果为非破坏性处理，可随时更改。
              </p>
              <a
                href="https://www.audacityteam.org/realtime-video"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-sm text-[11px] text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title="在新标签页观看 Audacity 实时效果介绍视频"
              >
                观看介绍视频
              </a>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeEffects.map((effect, index) => (
                <EffectChainItem
                  key={effect.id}
                  effect={effect}
                  index={index}
                  effectCount={activeEffects.length}
                  isMoving={isMovingEffect}
                  label={getEffectLabel(effect.type)}
                  isSelected={resolvedSelectedEffectId === effect.id}
                  onSelect={() => handleSelectEffect(effect.id)}
                  onToggleBypass={() => void handleToggleBypass(effect.id)}
                  onRemove={() => void handleRemoveEffect(effect.id)}
                  onMove={(toIndex, restoreGripFocus) => handleMoveEffect(effect.id, toIndex, restoreGripFocus)}
                  onDropEffect={(effectId, toIndex) => handleMoveEffect(effectId, toIndex)}
                  onReplace={(type) => handleReplaceEffect(effect.id, type)}
                  gripRef={(node) => {
                    if (node) gripElements.current.set(effect.id, node);
                    else gripElements.current.delete(effect.id);
                  }}
                  nameRef={(node) => {
                    if (node) effectNameElements.current.set(effect.id, node);
                    else effectNameElements.current.delete(effect.id);
                  }}
                  bypassRef={(node) => {
                    if (node) bypassElements.current.set(effect.id, node);
                    else bypassElements.current.delete(effect.id);
                  }}
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
              <div ref={parameterPanel} className="p-3">
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
                          disabled={isMovingEffect}
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
  effectCount,
  isMoving,
  label,
  isSelected,
  onSelect,
  onToggleBypass,
  onRemove,
  onMove,
  onDropEffect,
  onReplace,
  gripRef,
  nameRef,
  bypassRef,
}: {
  effect: IEffect;
  index: number;
  effectCount: number;
  isMoving: boolean;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  onToggleBypass: () => void;
  onRemove: () => void;
  onMove: (toIndex: number, restoreGripFocus?: boolean) => void;
  onDropEffect: (effectId: string, toIndex: number) => void;
  onReplace: (type: EffectType) => void;
  gripRef: (node: HTMLButtonElement | null) => void;
  nameRef: (node: HTMLButtonElement | null) => void;
  bypassRef: (node: HTMLButtonElement | null) => void;
}) {
  const icon = EFFECT_CATALOG.find((e) => e.type === effect.type)?.icon ?? <Sliders className="size-3.5" />;

  return (
    <div
      data-testid={`realtime-effect-${effect.id}`}
      className={`group flex items-center gap-1 rounded-md border p-1.5 transition-colors cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border/50 hover:border-border bg-background/50'
      } ${effect.bypassed ? 'opacity-50' : ''}`}
      onClick={onSelect}
      onDragOver={(event) => {
        if (isMoving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isMoving) return;
        const effectId = event.dataTransfer.getData('application/x-audacity-effect-id');
        if (effectId) onDropEffect(effectId, index);
      }}
    >
      <Button
        ref={gripRef}
        variant="ghost"
        size="icon"
        draggable={!isMoving}
        disabled={isMoving}
        aria-label={`拖动排序${label}`}
        title="拖动排序；聚焦后可用上下方向键移动"
        className="size-5 shrink-0 cursor-grab active:cursor-grabbing"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          if (isMoving) return;
          const toIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
          if (toIndex < 0 || toIndex >= effectCount) return;
          onMove(toIndex, true);
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          if (isMoving) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-audacity-effect-id', effect.id);
        }}
      >
        <GripVertical className="size-3 text-muted-foreground/70" />
      </Button>
      <button
        ref={nameRef}
        type="button"
        aria-label={`打开${label}参数`}
        title={`打开${label}参数`}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          <span className="block text-[10px] text-muted-foreground">#{index + 1}</span>
        </span>
      </button>
      <select
        aria-label={`替换${label}`}
        title={`将${label}替换为其他效果或将其移除；选择当前类型会重置参数`}
        className="h-6 w-6 shrink-0 cursor-pointer rounded bg-muted text-[9px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        value=""
        disabled={isMoving}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          event.stopPropagation();
          const value = event.target.value;
          if (value === '__remove__') {
            onRemove();
          } else if (value) {
            onReplace(value as EffectType);
          }
        }}
      >
        <option value="" disabled>▼</option>
        <option value="__remove__">移除效果</option>
        <optgroup label="替换为">
          {EFFECT_CATALOG.map((definition) => (
            <option key={definition.type} value={definition.type}>
              {definition.type === effect.type ? `✓ ${definition.label}` : definition.label}
            </option>
          ))}
        </optgroup>
      </select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={bypassRef}
            variant="ghost"
            size="icon"
            aria-label={effect.bypassed ? `启用${label}` : `旁路${label}`}
            disabled={isMoving}
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
      <Button
        variant="ghost"
        size="icon"
        aria-label={`上移${label}`}
        title={`上移${label}`}
        disabled={isMoving || index === 0}
        className="size-5 shrink-0"
        onClick={(event) => {
          event.stopPropagation();
          onMove(index - 1);
        }}
      >
        <ArrowUp className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`下移${label}`}
        title={`下移${label}`}
        disabled={isMoving || index === effectCount - 1}
        className="size-5 shrink-0"
        onClick={(event) => {
          event.stopPropagation();
          onMove(index + 1);
        }}
      >
        <ArrowDown className="size-3" />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`移除${label}`}
            disabled={isMoving}
            className="size-5 shrink-0 text-muted-foreground hover:text-destructive opacity-70 hover:opacity-100"
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
