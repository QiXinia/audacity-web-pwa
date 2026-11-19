import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { TRACK_DITHER_TYPES } from '@/lib/trackMedia';
import type { DitherType, HighQualitySampleRateConverter } from '@/types/project';
import { SAMPLE_RATE_CONVERTER_OPTIONS } from '@/lib/resampleEffect';

interface QualityPreferencesCardProps {
  value: DitherType;
  onChange: (value: DitherType) => void;
  converterValue: HighQualitySampleRateConverter;
  onConverterChange: (value: HighQualitySampleRateConverter) => void;
}

/** Audacity Quality preferences: High-quality Conversion options wired by this app. */
export function QualityPreferencesCard({
  value,
  onChange,
  converterValue,
  onConverterChange,
}: QualityPreferencesCardProps) {
  return (
    <Card data-testid="quality-preferences-card">
      <CardHeader>
        <CardTitle>Quality</CardTitle>
        <CardDescription>High-quality Conversion · Audacity Quality Preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="sample-rate-converter">Sample Rate Converter</Label>
          <select
            id="sample-rate-converter"
            aria-label="High-quality Conversion Sample Rate Converter"
            data-testid="sample-rate-converter"
            className="border-input bg-background h-9 w-full max-w-lg rounded-md border px-3 text-sm"
            value={converterValue}
            onChange={(event) => onConverterChange(event.target.value as HighQualitySampleRateConverter)}
          >
            {SAMPLE_RATE_CONVERTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            用于 Tracks → Resample 与 Track 右键 Resample；按官方 Resample.cpp 映射至 libsoxr LQ/MQ/HQ/VHQ，默认 Best Quality。
          </p>
        </div>
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
        <a
          className="text-primary text-xs underline underline-offset-4"
          href={`${import.meta.env.BASE_URL}third-party/NOTICE.md`}
          target="_blank"
          rel="noreferrer"
        >
          libsoxr 第三方许可、对应源码与构建说明
        </a>
      </CardContent>
    </Card>
  );
}
