import type { IAnalysisLabel, ITrack } from '@/types/project';

export function ClippingLabelTimeline({
  labels,
  tracks,
  pxPerSec,
  totalWidth,
  onSelect,
  onEdit,
}: {
  labels: readonly IAnalysisLabel[];
  tracks: readonly Pick<ITrack, 'id' | 'name'>[];
  pxPerSec: number;
  totalWidth: number;
  onSelect: (label: IAnalysisLabel) => void;
  onEdit: () => void;
}) {
  if (labels.length === 0) return null;
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));
  return (
    <div
      aria-label="标签轨"
      className="relative h-10 shrink-0 border-b border-[#434a50] bg-[#20262b]"
      style={{ width: totalWidth }}
    >
      {labels.map((label) => {
        const trackName = trackNames.get(label.trackId) ?? label.trackId;
        const source = label.kind === 'clipping' ? `Clipping · 声道 ${(label.channelIndex ?? 0) + 1}` : '手动标签';
        const displayText = label.text || '未命名标签';
        const title = `${trackName} · ${source} · ${displayText} · ${label.start.toFixed(6)}–${label.end.toFixed(6)} s`;
        return (
          <button
            key={label.id}
            type="button"
            aria-label={`${label.kind === 'clipping' ? '选择削波标签' : '选择标签'} ${displayText}`}
            title={`${title}；双击编辑标签`}
            className="absolute top-1 flex h-8 items-center overflow-hidden whitespace-nowrap rounded-sm border border-[#d3a64f] bg-[#6b5328]/90 px-1.5 text-left text-[10px] text-[#fff3d4] shadow-sm hover:bg-[#806434] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c56d]"
            style={{
              left: label.start * pxPerSec,
              width: Math.max(2, (label.end - label.start) * pxPerSec),
            }}
            onClick={() => onSelect(label)}
            onDoubleClick={onEdit}
          >
            <span className="sticky left-0">{displayText}</span>
          </button>
        );
      })}
    </div>
  );
}
