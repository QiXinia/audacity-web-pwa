import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ILabelTrack } from '@/types/project';
import type { LabelExportFileType } from '@/lib/labelTracks';

export interface LabelExportRequest {
  fileName: string;
  fileType: LabelExportFileType;
  trackIds: string[];
}

export default function ExportLabelsDialog({
  open,
  onOpenChange,
  tracks,
  initialTrackId,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tracks: readonly ILabelTrack[];
  initialTrackId?: string | null;
  onExport: (request: LabelExportRequest) => void;
}) {
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState<LabelExportFileType>('txt');
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName('');
    setFileType('txt');
    setSelectedTracks(initialTrackId && tracks.some((track) => track.id === initialTrackId)
      ? [initialTrackId]
      : tracks.map((track) => track.id));
    setError(null);
  }, [open, initialTrackId, tracks]);

  function setTrackSelected(trackId: string, selected: boolean) {
    setSelectedTracks((current) => selected
      ? [...new Set([...current, trackId])]
      : current.filter((id) => id !== trackId));
  }

  function exportData() {
    const trimmed = fileName.trim();
    if (!trimmed || selectedTracks.length === 0) return;
    setError(null);
    try {
      onExport({ fileName: trimmed, fileType, trackIds: selectedTracks });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="export-labels-dialog" className="max-w-[608px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Export labels</DialogTitle>
          <DialogDescription>导出所选 Label Tracks；浏览器将文件保存到默认下载目录。</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 px-5 py-4">
          <section aria-label="File" className="space-y-3">
            <h3 className="text-sm font-semibold">File</h3>
            <label className="grid grid-cols-[140px_1fr] items-center gap-3 text-sm">
              <span>File name</span>
              <Input
                data-testid="export-labels-file-name"
                value={fileName}
                autoFocus
                onChange={(event) => setFileName(event.target.value)}
              />
            </label>
            <label className="grid grid-cols-[140px_1fr] items-center gap-3 text-sm">
              <span>File type</span>
              <select
                data-testid="export-labels-file-type"
                aria-label="File type"
                className="h-9 rounded-md border border-input bg-background px-2"
                value={fileType}
                onChange={(event) => setFileType(event.target.value as LabelExportFileType)}
              >
                <option value="txt">Text file (*.txt)</option>
                <option value="srt">SubRip text file (*.srt)</option>
                <option value="vtt">WebVTT file (*.vtt)</option>
              </select>
            </label>
          </section>
          <section aria-label="Label tracks" className="space-y-3">
            <h3 className="text-sm font-semibold">Label tracks</h3>
            <div className="grid grid-cols-[140px_1fr] gap-3 text-sm">
              <span>Included label tracks</span>
              <div className="space-y-2">
                <div className="max-h-48 space-y-2 overflow-auto rounded-md border p-3">
                  {tracks.map((track) => (
                    <label key={track.id} className="flex items-center gap-2">
                      <input
                        data-testid={`export-label-track-${track.id}`}
                        type="checkbox"
                        checked={selectedTracks.includes(track.id)}
                        onChange={(event) => setTrackSelected(track.id, event.target.checked)}
                      />
                      <span className="truncate">{track.name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button data-testid="export-labels-select-all" type="button" variant="outline" size="sm" onClick={() => setSelectedTracks(tracks.map((track) => track.id))}>Select all</Button>
                  <Button data-testid="export-labels-deselect-all" type="button" variant="outline" size="sm" onClick={() => setSelectedTracks([])}>Deselect all</Button>
                </div>
              </div>
            </div>
          </section>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            data-testid="export-labels-confirm"
            type="button"
            disabled={!fileName.trim() || selectedTracks.length === 0}
            onClick={exportData}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
