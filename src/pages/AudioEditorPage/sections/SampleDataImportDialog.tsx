import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SampleDataInvalidDataHandling } from '@/lib/sampleDataImport';

export interface SampleDataImportCompletion {
  trackCount: number;
  invalidValueCount: number;
  paddedRightSample: boolean;
}

const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none hover:border-ring focus:border-ring disabled:cursor-not-allowed disabled:opacity-50';

export default function SampleDataImportDialog({
  open,
  onOpenChange,
  isImporting,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isImporting: boolean;
  onImport: (file: File, invalidDataHandling: SampleDataInvalidDataHandling) => Promise<SampleDataImportCompletion>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invalidDataHandling, setInvalidDataHandling] = useState<SampleDataInvalidDataHandling>('throw-error');
  const [importError, setImportError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<SampleDataImportCompletion | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setInvalidDataHandling('throw-error');
    setImportError(null);
    setCompletion(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open]);

  async function importData(): Promise<void> {
    if (!file || isImporting) return;
    setImportError(null);
    setCompletion(null);
    try {
      const result = await onImport(file, invalidDataHandling);
      setCompletion(result);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isImporting) onOpenChange(next); }}>
      <DialogContent data-testid="sample-data-import-dialog" className="max-w-[560px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Sample Data Import</DialogTitle>
          <DialogDescription>
            Generate audio from numeric samples in a plain ASCII text file. 导入会写入工程并新增一步撤销历史。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="sample-data-import-file">Select file</Label>
            <Input
              ref={inputRef}
              id="sample-data-import-file"
              type="file"
              disabled={isImporting}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setImportError(null);
                setCompletion(null);
              }}
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              Text file / All files。支持空白分隔的十进制、指数和分数；分号后为注释。文件必须只包含 ASCII 字节。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-data-import-invalid">Invalid data handling</Label>
            <select
              id="sample-data-import-invalid"
              className={SELECT_CLASS}
              value={invalidDataHandling}
              disabled={isImporting}
              onChange={(event) => {
                setInvalidDataHandling(event.target.value as SampleDataInvalidDataHandling);
                setCompletion(null);
              }}
            >
              <option value="throw-error">Throw Error</option>
              <option value="read-as-zero">Read as Zero</option>
            </select>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            声道沿用目标轨：单声道逐值读取，立体声按左右值成对读取；空轨默认单声道。奇数立体声值的最后一个右声道采样补零。选区存在时替换选区并平移后续片段，否则插入光标位置。
          </p>

          {importError && <p role="alert" className="text-xs text-destructive">{importError}</p>}
          {completion && (
            <p role="status" className="rounded-md border border-green-700/40 bg-green-700/10 px-3 py-2 text-xs">
              Imported {completion.trackCount} track{completion.trackCount === 1 ? '' : 's'}.
              {completion.invalidValueCount > 0 ? ` ${completion.invalidValueCount} invalid value${completion.invalidValueCount === 1 ? '' : 's'} read as zero.` : ''}
              {completion.paddedRightSample ? ' Final unpaired right sample padded with zero.' : ''}
            </p>
          )}
        </div>
        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={isImporting} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!file || isImporting} onClick={() => { void importData(); }}>
            <Upload className="mr-1 h-4 w-4" />{isImporting ? '导入中…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
