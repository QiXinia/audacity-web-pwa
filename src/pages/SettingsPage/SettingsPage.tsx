import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  HardDrive,
  Mic,
  AudioLines,
  Info,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Music,
  Cpu,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { isWasmAvailable } from '@/wasm/processor';
import { projectService } from '@/services/projectService';
import { audioDb } from '@/db/audioDb';
import { audioEngine } from '@/engine/audioEngine';
import type { IPreferences } from '@/types/project';

const DEFAULT_SAMPLE_RATES = [
  { value: '22050', label: '22050 Hz (低质量)' },
  { value: '44100', label: '44100 Hz (CD 质量)' },
  { value: '48000', label: '48000 Hz (标准)' },
  { value: '96000', label: '96000 Hz (高清)' },
  { value: '192000', label: '192000 Hz (母带级)' },
];

export default function SettingsPage() {
  const [preferences, setPreferences] = useState<IPreferences | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number; usageDetails: { projects: number; audioBuffers: number } } | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [bufferCount, setBufferCount] = useState(0);
  const [wasmAvailable, setWasmAvailable] = useState(false);
  const [clearDataDialog, setClearDataDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');

  useEffect(() => {
    loadPreferences();
    loadStorageInfo();
    loadMicPermission();
    setWasmAvailable(isWasmAvailable());
  }, []);

  async function loadPreferences() {
    try {
      const prefs = await projectService.getPreferences();
      setPreferences(prefs);
    } catch {}
  }

  async function loadStorageInfo() {
    try {
      const info = await projectService.getStorageInfo();
      setStorageInfo({ usage: info.usage, quota: info.quota, usageDetails: info.usageDetails });
      setProjectCount(info.usageDetails.projects);
      const buffers = await audioDb.audioBuffers.count();
      setBufferCount(buffers);
    } catch {}
  }

  async function loadMicPermission() {
    try {
      const result = await (navigator.permissions as any)?.query({ name: 'microphone' });
      if (result) {
        setMicPermission(result.state);
        result.addEventListener('change', () => setMicPermission(result.state));
      }
    } catch {
      setMicPermission('unsupported');
    }
  }

  async function requestMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
      toast.success('麦克风权限已授予');
    } catch {
      setMicPermission('denied');
      toast.error('麦克风权限被拒绝');
    }
  }

  async function updatePreference(key: keyof IPreferences, value: unknown) {
    if (!preferences) return;
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    try {
      await projectService.savePreferences(updated);
    } catch {}
  }

  async function handleClearAllData() {
    setIsClearing(true);
    try {
      await projectService.clearAllData();
      toast.success('所有数据已清除');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (e) {
      toast.error('清除数据失败');
    } finally {
      setIsClearing(false);
      setClearDataDialog(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  const storagePercent = storageInfo?.quota
    ? Math.min(100, (storageInfo.usage / storageInfo.quota) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SettingsIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">设置</h1>
            <p className="text-sm text-muted-foreground">偏好设置、存储管理与系统信息</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Audio Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AudioLines className="size-5 text-primary" />
                音频设置
              </CardTitle>
              <CardDescription>采样率与录音参数</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>默认采样率</Label>
                <Select
                  value={String(preferences?.defaultSampleRate ?? 48000)}
                  onValueChange={(v) => updatePreference('defaultSampleRate', parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_SAMPLE_RATES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  新建工程的默认采样率，越高音质越好但文件更大
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">麦克风权限</Label>
                  <p className="text-xs text-muted-foreground">录音功能需要麦克风访问权限</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      micPermission === 'granted'
                        ? 'default'
                        : micPermission === 'denied'
                          ? 'destructive'
                          : 'outline'
                    }
                    className="text-xs"
                  >
                    {micPermission === 'granted' && <CheckCircle2 className="mr-1 size-3" />}
                    {micPermission === 'denied' && <AlertTriangle className="mr-1 size-3" />}
                    {micPermission === 'granted'
                      ? '已授权'
                      : micPermission === 'denied'
                        ? '已拒绝'
                        : micPermission === 'prompt'
                          ? '未授权'
                          : '不支持'}
                  </Badge>
                  {micPermission !== 'granted' && micPermission !== 'unsupported' && (
                    <Button size="sm" variant="secondary" onClick={requestMicPermission}>
                      <Mic className="mr-1 size-3.5" />
                      申请权限
                    </Button>
                  )}
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Storage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-5 text-primary" />
                存储管理
              </CardTitle>
              <CardDescription>本地存储使用情况与配额</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">已使用</span>
                  <span className="font-medium tabular-nums">
                    {storageInfo ? formatBytes(storageInfo.usage) : '...'}
                    <span className="text-muted-foreground"> / </span>
                    {storageInfo ? formatBytes(storageInfo.quota) : '...'}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      storagePercent > 90
                        ? 'bg-destructive'
                        : storagePercent > 70
                          ? 'bg-warning'
                          : 'bg-primary'
                    }`}
                    style={{ width: `${storagePercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  存储在浏览器 IndexedDB 中，清除浏览器数据会丢失所有工程
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold tabular-nums">{projectCount}</div>
                  <div className="text-xs text-muted-foreground">工程数量</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-2xl font-bold tabular-nums">{bufferCount}</div>
                  <div className="text-xs text-muted-foreground">音频缓存</div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-warning/50 bg-warning/5 p-3">
                <AlertTriangle className="size-5 shrink-0 text-warning" />
                <div className="flex-1 text-xs text-muted-foreground">
                  <p className="font-medium text-warning-foreground">注意</p>
                  <p>
                    所有数据仅保存在浏览器本地。清除浏览器缓存、更换设备或使用无痕模式都会导致数据丢失。建议定期导出重要工程。
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t border-border/50">
              <div className="flex w-full items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">清除所有数据</Label>
                  <p className="text-xs text-muted-foreground">删除所有工程与音频缓存</p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setClearDataDialog(true)}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  清除数据
                </Button>
              </div>
            </CardFooter>
          </Card>

          {/* Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-5 text-primary" />
                性能与技术
              </CardTitle>
              <CardDescription>音频处理模块与系统信息</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`size-2 rounded-full ${
                      wasmAvailable ? 'bg-success' : 'bg-muted-foreground'
                    }`}
                  />
                  <div>
                    <Label className="text-sm font-medium">WASM 加速</Label>
                    <p className="text-xs text-muted-foreground">
                      {wasmAvailable
                        ? 'Rust/WASM 音频处理模块已加载'
                        : '使用纯 JavaScript 降级实现'}
                    </p>
                  </div>
                </div>
                <Badge variant={wasmAvailable ? 'default' : 'outline'}>
                  {wasmAvailable ? '已启用' : '未启用'}
                </Badge>
              </div>

              {!wasmAvailable && (
                <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                  <span className="font-medium">JavaScript 降级模式</span>
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">音频引擎</span>
                  <p className="font-medium">Web Audio API</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">数据存储</span>
                  <p className="font-medium">IndexedDB</p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">PWA 支持</span>
                  <p className="font-medium">
                    {('serviceWorker' in navigator) ? '可用' : '不支持'}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">离线使用</span>
                  <p className="font-medium">支持</p>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* About */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="size-5 text-primary" />
                关于
              </CardTitle>
              <CardDescription>版本信息与开源许可</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Music className="size-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">WebAudacity</h3>
                  <p className="text-sm text-muted-foreground">Web 版音频编辑器 v0.1.0</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                这是一个独立的 Web 重构实现，基于 React + Rust/WASM + IndexedDB 构建。
                参考了 Audacity 的界面与工作流，但不隶属于 Audacity 官方团队。
              </p>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">程序许可</span>
                  <span className="font-medium">GNU General Public License v3.0</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">文档许可</span>
                  <span className="font-medium">Creative Commons BY 3.0</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">源代码</span>
                  <span className="font-medium">GitHub 开源</span>
                </div>
              </div>

              <div className="rounded-md bg-muted/50 p-3 text-[11px] text-muted-foreground">
                <p className="mb-1 font-medium">免责声明</p>
                <p>
                  本项目是独立开发的 Web 音频编辑器，与 Audacity® 商标及其官方团队无关。
                  Audacity 是其各自所有者的商标。本项目旨在学习与探索 Web 音频技术，
                  不冒充官方产品。
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                独立、非官方 Web 重构 · 源码采用 GPLv3，文档采用 CC BY 3.0。
              </p>
              <div className="flex gap-2 w-full">
                <a href="https://www.audacityteam.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-input bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-accent transition-colors"
                >
                  <Download className="size-3.5" />
                  Audacity 官网
                </a>
                <a href="https://github.com/QiXinia/audacity-web-pwa"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-input bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-accent transition-colors"
                >
                  <Shield className="size-3.5" />
                  项目源码
                </a>
              </div>
            </CardFooter>
          </Card>
        </div>
      </motion.div>

      <AlertDialog open={clearDataDialog} onOpenChange={setClearDataDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              确认清除所有数据？
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除所有工程、音频片段和设置数据，且无法恢复。
              请确保已导出所有重要工程。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">危险操作</p>
            <p className="text-xs opacity-80">删除后数据将完全丢失，无法找回</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAllData}
              disabled={isClearing}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isClearing ? '清除中...' : '确认清除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
