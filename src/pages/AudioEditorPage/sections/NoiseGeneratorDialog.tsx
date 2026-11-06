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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTime } from '@/lib/audioUtils';
import type { NoiseRequest, NoiseType } from '@/lib/noiseGenerator';

interface NoiseGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleRate: number;
  cursorPosition: number;
  defaultDuration: number;
  isGenerating: boolean;
  onGenerate: (settings: NoiseRequest) => void | Promise<void>;
}

export default function NoiseGeneratorDialog({
  open,
  onOpenChange,
  sampleRate,
  cursorPosition,
  defaultDuration,
  isGenerating,
  onGenerate,
}: NoiseGeneratorDialogProps) {
  const [type, setType] = useState<NoiseType>('white');
  const [amplitude, setAmplitude] = useState('0.8');
  const [duration, setDuration] = useState('5');

  useEffect(() => {
    if (open && Number.isFinite(defaultDuration) && defaultDuration > 0) {
      setDuration(String(defaultDuration));
    }
  }, [open, defaultDuration]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void onGenerate({ type, amplitude: Number(amplitude), duration: Number(duration) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>生成噪声</DialogTitle>
          <DialogDescription>
            按 Audacity Noise 的白噪声、粉红噪声和布朗噪声算法生成真实单声道音频片段。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="noise-type">噪声类型</Label>
            <Select value={type} onValueChange={(value) => setType(value as NoiseType)}>
              <SelectTrigger id="noise-type" aria-label="噪声类型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="white">白噪声 (White)</SelectItem>
                <SelectItem value="pink">粉红噪声 (Pink)</SelectItem>
                <SelectItem value="brownian">布朗噪声 (Brownian)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="noise-amplitude">振幅 (0–1)</Label>
              <Input
                id="noise-amplitude"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={amplitude}
                onChange={(event) => setAmplitude(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noise-duration">时长（秒）</Label>
              <Input
                id="noise-duration"
                type="number"
                min="0.001"
                step="0.001"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            采样率 {sampleRate} Hz · 插入位置 {formatTime(cursorPosition)} · 有选区时默认使用选区时长
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={isGenerating}>
              {isGenerating ? '正在生成…' : '生成噪声'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
