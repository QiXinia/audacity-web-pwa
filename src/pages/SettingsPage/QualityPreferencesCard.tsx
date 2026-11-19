import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { TRACK_DITHER_TYPES } from '@/lib/trackMedia';
import type { DitherType } from '@/types/project';

interface QualityPreferencesCardProps {
  value: DitherType;
  onChange: (value: DitherType) => void;
}

/** Audacity Quality preferences: only the conversion option wired by this app. */
export function QualityPreferencesCard({ value, onChange }: QualityPreferencesCardProps) {
  return (
    <Card data-testid="quality-preferences-card">
      <CardHeader>
        <CardTitle>Quality</CardTitle>
        <CardDescription>High-quality Conversion · Audacity Quality Preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="high-quality-dither">Dither</Label>
          <select
            id="high-quality-dither"
            aria-label="High-quality Conversion Dither"
            data-testid="high-quality-dither"
            className="border-input bg-background h-9 w-full max-w-lg rounded-md border px-3 text-sm"
            value={value}
            onChange={(event) => onChange(event.target.value as DitherType)}
          >
            {TRACK_DITHER_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          用于 Track Format 缩窄 PCM 的高质量转换，默认 Shaped；对应 Audacity
          <code className="mx-1">/Quality/HQDitherAlgorithmChoice</code>。
          选择 None 可关闭 dither，设置保存在当前浏览器并立即用于后续转换。
        </p>
      </CardContent>
    </Card>
  );
}
