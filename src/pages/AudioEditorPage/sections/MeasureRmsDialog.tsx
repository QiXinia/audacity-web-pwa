import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatRmsDb, type RmsSelectionMeasurement } from '@/lib/measureRms';

export interface MeasureRmsTrackResult {
  trackId: string;
  trackName: string;
  measurement: RmsSelectionMeasurement;
}

export default function MeasureRmsDialog({
  open,
  onOpenChange,
  selectionStart,
  selectionEnd,
  results,
  isMeasuring,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectionStart: number;
  selectionEnd: number;
  results: readonly MeasureRmsTrackResult[];
  isMeasuring: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="measure-rms-dialog" className="max-w-[520px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Measure RMS</DialogTitle>
          <DialogDescription>
            Measures RMS volume for the selected audio. 只读分析不会修改工程或新增撤销历史。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <p className="text-xs text-muted-foreground">选区：{selectionStart.toFixed(3)}–{selectionEnd.toFixed(3)} 秒</p>
          {isMeasuring && <p role="status" className="text-sm">正在测量 RMS…</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!isMeasuring && !error && results.map(({ trackId, trackName, measurement }) => {
            const rows = measurement.channels.length === 1
              ? [{ label: 'Mono', value: measurement.channels[0] }]
              : [
                  { label: 'Left', value: measurement.channels[0] },
                  { label: 'Right', value: measurement.channels[1] },
                  { label: 'Stereo', value: measurement.stereo! },
                ];
            return (
              <section key={trackId} aria-label={`${trackName} RMS results`} className="rounded-md border">
                <h3 className="border-b bg-muted/20 px-3 py-2 text-sm font-medium">{trackName}</h3>
                <dl className="divide-y">
                  {rows.map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[1fr_auto] gap-4 px-3 py-2 text-sm">
                      <dt>{label}:</dt>
                      <dd>
                        <output aria-label={`${trackName} ${label} RMS`} className="font-mono tabular-nums">
                          {formatRmsDb(value.rmsDb)}
                        </output>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
