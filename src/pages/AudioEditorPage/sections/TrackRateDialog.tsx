import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_RESAMPLE_RATE,
  MIN_RESAMPLE_RATE,
  parseResampleRate,
  RESAMPLE_RATE_CHOICES,
} from '@/lib/resampleEffect';

interface TrackRateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRate: number;
  selectedTrackCount: number;
  isChangingRate: boolean;
  onChangeRate: (newRate: number) => void | Promise<void>;
}

/** Audacity 4 Set rate: changes timeline interpretation, not PCM samples. */
export default function TrackRateDialog({
  open,
  onOpenChange,
  initialRate,
  selectedTrackCount,
  isChangingRate,
  onChangeRate,
}: TrackRateDialogProps) {
  const [rateText, setRateText] = useState(String(Math.round(initialRate)));
  const newRate = parseResampleRate(rateText);

  useEffect(() => {
    if (open) setRateText(String(Math.round(initialRate)));
  }, [open, initialRate]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (newRate !== null && !isChangingRate) void onChangeRate(newRate);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!isChangingRate) onOpenChange(nextOpen);
    }}>
      <DialogContent data-testid="track-rate-dialog" className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Set rate</DialogTitle>
          <DialogDescription>
            Change the selected tracks&apos; rate without resampling PCM. Clip positions, trims and durations scale by old rate / new rate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="track-rate-input">New sample rate (Hz):</Label>
            <Input
              id="track-rate-input"
              data-testid="track-rate-input"
              type="text"
              inputMode="numeric"
              list="track-rate-choices"
              value={rateText}
              disabled={isChangingRate}
              onChange={(event) => setRateText(event.target.value)}
              aria-describedby="track-rate-help track-rate-error"
              aria-invalid={newRate === null}
              autoFocus
            />
            <datalist id="track-rate-choices">
              {RESAMPLE_RATE_CHOICES.map((rate) => <option key={rate} value={rate} />)}
            </datalist>
            <p id="track-rate-help" className="text-xs text-muted-foreground">
              Enter an integer from {MIN_RESAMPLE_RATE.toLocaleString()}–{MAX_RESAMPLE_RATE.toLocaleString()} Hz for {selectedTrackCount} selected track(s).
            </p>
          </div>
          {newRate === null && (
            <p id="track-rate-error" role="alert" className="text-sm text-destructive">
              The entered value is invalid. Enter an integer sample rate from 1 to 1000000 Hz.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={isChangingRate} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="track-rate-confirm"
              disabled={newRate === null || isChangingRate || selectedTrackCount === 0}
            >
              {isChangingRate ? 'Setting rate…' : 'Set rate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
