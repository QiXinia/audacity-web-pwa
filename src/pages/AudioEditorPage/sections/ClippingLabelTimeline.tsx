import { useState } from 'react';
import type { IAnalysisLabel, ILabelTrack, ITrack } from '@/types/project';
import { CLIP_COLORS } from '@/lib/clipColor';
import { getLabelTrackColor, resolveAnalysisLabelTrackId } from '@/lib/labelTracks';
import type { TrackMoveDirection } from '@/lib/trackMove';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export function ClippingLabelTimeline({
  labels,
  labelTracks,
  tracks,
  pxPerSec,
  totalWidth,
  offsetX = 0,
  onSelect,
  onEdit,
  onRenameTrack,
  onDuplicateTrack,
  onDeleteTrack,
  onMoveTrack,
  onTrackColorChange,
  onExportLabels,
}: {
  labels: readonly IAnalysisLabel[];
  labelTracks: readonly ILabelTrack[];
  tracks: readonly Pick<ITrack, 'id' | 'name'>[];
  pxPerSec: number;
  totalWidth: number;
  offsetX?: number;
  onSelect: (label: IAnalysisLabel) => void;
  onEdit: () => void;
  onRenameTrack: (trackId: string, name: string) => void;
  onDuplicateTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: TrackMoveDirection) => void;
  onTrackColorChange: (trackId: string, colorIndex: number) => void;
  onExportLabels: (trackId: string) => void;
}) {
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  if (labelTracks.length === 0) return null;
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));

  function commitRename(trackId: string) {
    const name = draftName.trim();
    if (name) onRenameTrack(trackId, name);
    setEditingTrackId(null);
  }

  return (
    <div aria-label="标签轨" data-testid="label-tracks">
      {labelTracks.map((labelTrack, trackIndex) => {
        const color = getLabelTrackColor(labelTrack);
        const laneLabels = labels.filter((label) => (
          resolveAnalysisLabelTrackId(label, labelTracks) === labelTrack.id
        ));
        return (
          <ContextMenu key={labelTrack.id}>
            <ContextMenuTrigger asChild>
              <div
                data-testid={`label-track-${labelTrack.id}`}
                data-label-track-id={labelTrack.id}
                data-track-color={color}
                aria-label={`Label Track ${labelTrack.name}`}
                className="relative h-10 shrink-0 border-b border-[#434a50] bg-[#20262b]"
                style={{ width: totalWidth + offsetX }}
              >
                <div
                  className="absolute inset-y-0 left-0 z-10 flex items-center gap-1 overflow-hidden border-r border-[#434a50] bg-[#20262b] px-2"
                  style={{ width: offsetX, borderLeft: `4px solid ${color}` }}
                >
                  {editingTrackId === labelTrack.id ? (
                    <input
                      aria-label={`Label Track name ${labelTrack.name}`}
                      className="h-6 min-w-0 flex-1 rounded-sm border border-[#d3a64f] bg-[#11171c] px-1 text-[11px] text-white outline-none"
                      value={draftName}
                      autoFocus
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => commitRename(labelTrack.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingTrackId(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="truncate text-[11px] font-medium text-[#f2f4f6]" title={labelTrack.name}>
                      {labelTrack.name}
                    </span>
                  )}
                </div>
                {laneLabels.map((label) => {
                  const trackName = trackNames.get(label.trackId) ?? label.trackId;
                  const source = label.kind === 'clipping' ? `Clipping · 声道 ${(label.channelIndex ?? 0) + 1}` : '手动标签';
                  const displayText = label.text || '未命名标签';
                  const title = `${labelTrack.name} · ${trackName} · ${source} · ${displayText} · ${label.start.toFixed(6)}–${label.end.toFixed(6)} s`;
                  return (
                    <button
                      key={label.id}
                      type="button"
                      aria-label={`${label.kind === 'clipping' ? '选择削波标签' : '选择标签'} ${displayText}`}
                      title={`${title}；双击编辑标签`}
                      className="absolute top-1 flex h-8 items-center overflow-hidden whitespace-nowrap rounded-sm border bg-[#6b5328]/90 px-1.5 text-left text-[10px] text-[#fff3d4] shadow-sm hover:bg-[#806434] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c56d]"
                      style={{
                        left: offsetX + label.start * pxPerSec,
                        width: Math.max(2, (label.end - label.start) * pxPerSec),
                        borderColor: color,
                      }}
                      onClick={() => onSelect(label)}
                      onDoubleClick={onEdit}
                    >
                      <span className="sticky left-0">{displayText}</span>
                    </button>
                  );
                })}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56" data-testid={`label-track-context-menu-${labelTrack.id}`}>
              <ContextMenuItem
                data-testid="label-track-rename-menu"
                onSelect={() => {
                  setDraftName(labelTrack.name);
                  window.setTimeout(() => setEditingTrackId(labelTrack.id), 0);
                }}
              >
                Rename track
              </ContextMenuItem>
              <ContextMenuItem data-testid="label-track-duplicate-menu" onSelect={() => onDuplicateTrack(labelTrack.id)}>
                Duplicate track
              </ContextMenuItem>
              <ContextMenuItem data-testid="label-track-delete-menu" onSelect={() => onDeleteTrack(labelTrack.id)}>
                Delete track
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger data-testid="label-track-move-submenu">Move track</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  <ContextMenuItem disabled={trackIndex === 0} onSelect={() => onMoveTrack(labelTrack.id, 'up')}>Move up</ContextMenuItem>
                  <ContextMenuItem disabled={trackIndex === labelTracks.length - 1} onSelect={() => onMoveTrack(labelTrack.id, 'down')}>Move down</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem disabled={trackIndex === 0} onSelect={() => onMoveTrack(labelTrack.id, 'top')}>Move to top</ContextMenuItem>
                  <ContextMenuItem disabled={trackIndex === labelTracks.length - 1} onSelect={() => onMoveTrack(labelTrack.id, 'bottom')}>Move to bottom</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSub>
                <ContextMenuSubTrigger data-testid="label-track-color-submenu">Track color</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  <ContextMenuRadioGroup
                    value={String(labelTrack.colorIndex ?? 0)}
                    onValueChange={(value) => onTrackColorChange(labelTrack.id, Number(value))}
                  >
                    {CLIP_COLORS.map((entry) => (
                      <ContextMenuRadioItem key={entry.index} value={String(entry.index)} data-testid={`label-track-color-${entry.index}`}>
                        <span aria-hidden="true" className="size-3 rounded-sm border border-black/10" style={{ backgroundColor: entry.color }} />
                        {entry.name}
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem data-testid="label-track-export-menu" onSelect={() => onExportLabels(labelTrack.id)}>
                Export labels
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}
