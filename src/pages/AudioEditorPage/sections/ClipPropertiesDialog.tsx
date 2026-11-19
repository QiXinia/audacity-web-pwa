import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CLIP_COLORS, getClipColor, getClipColorIndex } from '@/lib/clipColor';
import { getClipOptimizeForVoice } from '@/lib/clipPitchSpeed';
import { formatClipPitchCents, formatClipPropertyTime, getClipTimeMapping } from '@/lib/clipProperties';
import { isClipStretchToMatchTempo } from '@/lib/clipTempo';
import { projectService, type AudioBufferMetadata } from '@/services/projectService';
import type { IClip, ITrack } from '@/types/project';

interface ClipPropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clip: IClip;
  track: ITrack;
}

type MetadataState = 'loading' | 'ready' | 'missing' | 'error';

function PropertyRow({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[minmax(110px,0.8fr)_minmax(0,1.2fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium" data-testid={testId}>{value}</dd>
    </div>
  );
}

function PropertySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="divide-y divide-border/60">{children}</dl>
    </section>
  );
}

export function ClipPropertiesDialog({ open, onOpenChange, clip, track }: ClipPropertiesDialogProps) {
  const [metadata, setMetadata] = useState<AudioBufferMetadata | null>(null);
  const [metadataState, setMetadataState] = useState<MetadataState>('loading');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setMetadata(null);
    setMetadataState('loading');
    void projectService.loadAudioBufferMetadata(clip.audioBufferId)
      .then((record) => {
        if (!active) return;
        setMetadata(record);
        setMetadataState(record ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!active) return;
        setMetadata(null);
        setMetadataState('error');
      });
    return () => { active = false; };
  }, [open, clip.audioBufferId]);

  const mapping = getClipTimeMapping(clip);
  const colorIndex = getClipColorIndex(clip);
  const colorName = colorIndex === 0
    ? 'Same as track color'
    : CLIP_COLORS.find((entry) => entry.index === colorIndex)?.name ?? 'Same as track color';
  const channelLabel = metadata
    ? metadata.channels === 1 ? 'Mono (1 channel)' : metadata.channels === 2 ? 'Stereo (2 channels)' : `${metadata.channels} channels`
    : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[680px]" data-testid="clip-properties-dialog">
        <DialogHeader>
          <DialogTitle>Clip properties</DialogTitle>
          <DialogDescription>
            当前 Web 工程中片段与源音频的真实映射；只读查看，不会修改音频。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <PropertySection title="Clip">
            <PropertyRow label="Name" value={clip.name || '音频片段'} />
            <PropertyRow label="Track" value={track.name} />
            <PropertyRow
              label="Color"
              value={(
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-sm border border-black/20"
                    style={{ backgroundColor: getClipColor(clip, track.color) }}
                  />
                  {colorName}
                </span>
              )}
            />
            <PropertyRow label="Gain" value={`${clip.gain.toFixed(2)} dB`} />
            <PropertyRow label="Fade in" value={formatClipPropertyTime(clip.fadeIn)} />
            <PropertyRow label="Fade out" value={formatClipPropertyTime(clip.fadeOut)} />
          </PropertySection>

          <PropertySection title="Timeline">
            <PropertyRow label="Start" value={formatClipPropertyTime(mapping.timelineStart)} testId="clip-property-timeline-start" />
            <PropertyRow label="End" value={formatClipPropertyTime(mapping.timelineEnd)} testId="clip-property-timeline-end" />
            <PropertyRow label="Duration" value={formatClipPropertyTime(mapping.timelineDuration)} testId="clip-property-timeline-duration" />
            <PropertyRow label="Speed" value={`${mapping.speedPercentage.toFixed(3)}%`} testId="clip-property-speed" />
            <PropertyRow label="Stretch ratio" value={`${mapping.stretchRatio.toFixed(6)}× source / timeline`} />
            <PropertyRow label="Pitch" value={formatClipPitchCents(clip)} testId="clip-property-pitch" />
          </PropertySection>

          <PropertySection title="Source audio">
            <PropertyRow label="Window start" value={formatClipPropertyTime(mapping.sourceStart)} testId="clip-property-source-start" />
            <PropertyRow label="Window end" value={formatClipPropertyTime(mapping.sourceEnd)} testId="clip-property-source-end" />
            <PropertyRow label="Window duration" value={formatClipPropertyTime(mapping.sourceDuration)} testId="clip-property-source-duration" />
            <PropertyRow label="Sample rate" value={metadata ? `${metadata.sampleRate} Hz` : '—'} testId="clip-property-sample-rate" />
            <PropertyRow label="Channels" value={channelLabel} testId="clip-property-channels" />
            <PropertyRow
              label="Source length"
              value={metadata ? `${formatClipPropertyTime(metadata.duration)} · ${metadata.length.toLocaleString('en-US')} frames` : '—'}
              testId="clip-property-source-length"
            />
          </PropertySection>

          <PropertySection title="Tempo and processing">
            <PropertyRow label="Stretch with tempo changes" value={isClipStretchToMatchTempo(clip) ? 'On' : 'Off'} />
            <PropertyRow label="Clip tempo" value={clip.clipTempo ? `${clip.clipTempo} BPM` : 'Not set'} />
            <PropertyRow label="Source tempo" value={clip.rawAudioTempo ? `${clip.rawAudioTempo} BPM` : 'Not set'} />
            <PropertyRow label="Optimize for voice" value={getClipOptimizeForVoice(clip) ? 'On · StaffPad phase vocoder + formant shifter' : 'Off'} />
          </PropertySection>
        </div>

        <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="clip-properties-metadata-state">
          {metadataState === 'loading' && '正在读取源音频元数据…'}
          {metadataState === 'missing' && '未找到源音频元数据；时间线与源窗口仍按 Clip 数据显示。'}
          {metadataState === 'error' && '源音频元数据读取失败；时间线与源窗口仍按 Clip 数据显示。'}
          {metadataState === 'ready' && `Audio buffer: ${metadata?.id}`}
        </p>

        <DialogFooter>
          <Button type="button" data-testid="clip-properties-close" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
