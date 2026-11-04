import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  Plus,
  Search,
  MoreVertical,
  Trash2,
  RefreshCw,
  Music2,
  Clock,
  HardDrive,
  AlertCircle,
  X,
  Pencil,
  FileAudio,
  Trash,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from '@/components/ui/empty';
import { projectService } from '@/services/projectService';
import { formatDuration, formatFileSize } from '@/lib/audioUtils';
import type { IProjectSummary } from '@/types/project';

export default function ProjectManagerPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<IProjectSummary[]>([]);
  const [deletedProjects, setDeletedProjects] = useState<IProjectSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSampleRate, setNewSampleRate] = useState('44100');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProject, setSelectedProject] = useState<IProjectSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IProjectSummary | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<IProjectSummary | null>(null);
  const [storageInfo, setStorageInfo] = useState<{
    quota: number;
    usage: number;
    audioBufferSize: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setNewSampleRate(String(projectService.getPreferences().defaultSampleRate));
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    try {
      const [active, deleted, storage] = await Promise.all([
        projectService.listProjects(false),
        projectService.listDeletedProjects(),
        projectService.getStorageInfo(),
      ]);
      setProjects(active);
      setDeletedProjects(deleted);
      setStorageInfo({
        quota: storage.quota,
        usage: storage.usage,
        audioBufferSize: storage.usageDetails.audioBuffers,
      });
    } catch (e) {
      toast.error('加载工程列表失败');
    } finally {
      setIsLoading(false);
    }
  }

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, searchQuery]);

  const filteredDeleted = useMemo(() => {
    if (!searchQuery.trim()) return deletedProjects;
    const q = searchQuery.toLowerCase();
    return deletedProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [deletedProjects, searchQuery]);

  async function handleCreateProject() {
    if (!newName.trim()) {
      toast.error('请输入工程名称');
      return;
    }
    setIsCreating(true);
    try {
      const project = await projectService.createProject(newName.trim(), parseInt(newSampleRate));
      toast.success('工程已创建');
      setIsNewDialogOpen(false);
      setNewName('');
      navigate(`/editor/${project.id}`);
    } catch (e) {
      toast.error('创建工程失败');
    } finally {
      setIsCreating(false);
    }
  }

  function openRename(project: IProjectSummary) {
    setSelectedProject(project);
    setRenameValue(project.name);
    setIsRenameOpen(true);
  }

  async function handleRename() {
    if (!selectedProject || !renameValue.trim()) return;
    try {
      await projectService.renameProject(selectedProject.id, renameValue.trim());
      toast.success('重命名成功');
      setIsRenameOpen(false);
      loadData();
    } catch {
      toast.error('重命名失败');
    }
  }

  async function handleDelete(project: IProjectSummary) {
    try {
      await projectService.deleteProject(project.id);
      toast.success('已移至回收站');
      setDeleteTarget(null);
      loadData();
    } catch {
      toast.error('删除失败');
    }
  }

  async function handleRestore(project: IProjectSummary) {
    try {
      await projectService.restoreProject(project.id);
      toast.success('已恢复工程');
      setRestoreTarget(null);
      loadData();
    } catch {
      toast.error('恢复失败');
    }
  }

  async function handlePermanentDelete(project: IProjectSummary) {
    try {
      await projectService.permanentlyDeleteProject(project.id);
      toast.success('已永久删除');
      setDeleteTarget(null);
      loadData();
    } catch {
      toast.error('删除失败');
    }
  }

  function openProject(project: IProjectSummary) {
    navigate(`/editor/${project.id}`);
  }

  const usagePercent = storageInfo?.quota
    ? Math.min(100, (storageInfo.usage / storageInfo.quota) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6">
        {/* Hero Section */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-4 border-b border-border pb-4"
        >
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-xl space-y-3">
              <h1 className="text-xl font-semibold text-foreground">
                Audacity <span className="text-primary">Web</span>
              </h1>
              <p className="text-sm text-muted-foreground">
                本地多轨音频工作区 · 工程与素材仅保存在当前浏览器
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={() => setIsNewDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  新建工程
                </Button>
                <Button variant="secondary" onClick={() => document.getElementById('project-input')?.click()}>
                  <FileAudio className="mr-2 size-4" />
                  导入音频
                </Button>
                <input
                  id="project-input"
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;
                    // Create project and import
                    const project = await projectService.createProject(
                      files[0].name.replace(/\.[^.]+$/, ''),
                    );
                    const track = project.tracks[0];
                    let progress = 0;
                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      const tid = i === 0 ? track.id : (await projectService.addTrack(project.id))?.id;
                      if (tid) {
                        await projectService.importAudioToTrack(
                          project.id,
                          tid,
                          file,
                          0,
                          (p) => {
                            progress = (i + p) / files.length;
                          },
                        );
                      }
                    }
                    toast.success(`已导入 ${files.length} 个音频文件`);
                    navigate(`/editor/${project.id}`);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-xl font-semibold text-primary">{projects.length}</div>
                <div className="text-xs text-muted-foreground">我的工程</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold text-foreground">
                  {storageInfo ? formatFileSize(storageInfo.audioBufferSize) : '—'}
                </div>
                <div className="text-xs text-muted-foreground">音频数据</div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Storage Quota Bar */}
        {storageInfo && storageInfo.quota > 0 && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="flex items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">存储使用情况</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(storageInfo.usage)} / {formatFileSize(storageInfo.quota)}
                </span>
              </div>
              <Progress value={usagePercent} className="h-2" />
              {usagePercent > 80 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-warning">
                  <AlertCircle className="size-3" />
                  存储空间即将不足，请及时清理不需要的工程
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Projects Section */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-lg">我的工程</CardTitle>
              <CardDescription>管理所有本地保存的音频工程</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="搜索工程..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button onClick={() => setIsNewDialogOpen(true)}>
                <Plus className="mr-2 size-4" />
                新建
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs defaultValue="active" className="w-full">
              <div className="border-b border-border px-6 pt-2">
                <TabsList>
                  <TabsTrigger value="active" className="relative">
                    进行中
                    <Badge variant="secondary" className="ml-2">
                      {projects.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="deleted">
                    回收站
                    <Badge variant="secondary" className="ml-2">
                      {deletedProjects.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="active" className="p-0">
                {isLoading ? (
                  <div className="p-12 text-center text-muted-foreground">加载中...</div>
                ) : filteredProjects.length === 0 ? (
                  <div className="p-12">
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia variant="icon">
                          <FolderOpen className="size-6" />
                        </EmptyMedia>
                        <EmptyHeader>
                          <EmptyTitle>{searchQuery ? '未找到匹配的工程' : '暂无工程'}</EmptyTitle>
                          <EmptyDescription>
                            {searchQuery ? '尝试其他关键词' : '创建第一个音频工程开始编辑'}
                          </EmptyDescription>
                        </EmptyHeader>
                        {!searchQuery && (
                          <Button onClick={() => setIsNewDialogOpen(true)} className="mt-2">
                            <Plus className="mr-2 size-4" />
                            新建工程
                          </Button>
                        )}
                      </EmptyContent>
                    </Empty>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredProjects.map((project, index) => (
                      <motion.div
                        key={project.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.03 }}
                        className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
                      >
                        <div
                          className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                          onClick={() => openProject(project)}
                        >
                          <Music2 className="size-6" />
                        </div>

                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openProject(project)}>
                          <div className="font-medium text-foreground">{project.name}</div>
                          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {formatDuration(project.duration)}
                            </span>
                            <span>{project.trackCount} 轨道</span>
                            <span>{project.sampleRate} Hz</span>
                            <span>
                              更新于 {format(project.updatedAt, 'MM月dd日 HH:mm', { locale: zhCN })}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openProject(project)}
                          >
                            打开
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openProject(project)}>
                                <FolderOpen className="mr-2 size-4" />
                                打开工程
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openRename(project)}>
                                <Pencil className="mr-2 size-4" />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteTarget(project)}
                              >
                                <Trash2 className="mr-2 size-4" />
                                移至回收站
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="deleted" className="p-0">
                {filteredDeleted.length === 0 ? (
                  <div className="p-12">
                    <Empty>
                      <EmptyContent>
                        <EmptyMedia variant="icon">
                          <Trash className="size-6" />
                        </EmptyMedia>
                        <EmptyHeader>
                          <EmptyTitle>回收站为空</EmptyTitle>
                          <EmptyDescription>
                            删除的工程将显示在这里，可以恢复或永久删除
                          </EmptyDescription>
                        </EmptyHeader>
                      </EmptyContent>
                    </Empty>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredDeleted.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center gap-4 px-6 py-3 opacity-80"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Trash2 className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground">{project.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDuration(project.duration)} · {project.trackCount} 轨道 · 删除于
                            {project.deletedAt
                              ? format(project.deletedAt, ' MM月dd日 HH:mm', { locale: zhCN })
                              : ''}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRestore(project)}
                          >
                            <RefreshCw className="mr-2 size-3" />
                            恢复
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setRestoreTarget(project)}
                          >
                            永久删除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* New Project Dialog */}
        <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建工程</DialogTitle>
              <DialogDescription>创建一个新的音频编辑工程</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="project-name">工程名称</Label>
                <Input
                  id="project-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入工程名称"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sample-rate">采样率</Label>
                <Select value={newSampleRate} onValueChange={setNewSampleRate}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择采样率" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="44100">44100 Hz (CD 质量)</SelectItem>
                    <SelectItem value="48000">48000 Hz (专业质量)</SelectItem>
                    <SelectItem value="96000">96000 Hz (高解析)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setIsNewDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreateProject} disabled={isCreating || !newName.trim()}>
                {isCreating ? '创建中...' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog */}
        <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重命名工程</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>新名称</Label>
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setIsRenameOpen(false)}>
                取消
              </Button>
              <Button onClick={handleRename} disabled={!renameValue.trim()}>
                确定
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除工程</AlertDialogTitle>
              <AlertDialogDescription>
                确定要将「{deleteTarget?.name}」移至回收站吗？您可以在回收站中恢复它。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => deleteTarget && handleDelete(deleteTarget)}
              >
                移至回收站
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Permanent Delete Confirm */}
        <AlertDialog
          open={!!restoreTarget && restoreTarget.status === 'deleted'}
          onOpenChange={(open) => !open && setRestoreTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>永久删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要永久删除「{restoreTarget?.name}」吗？此操作不可撤销，所有音频数据将被清除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => restoreTarget && handlePermanentDelete(restoreTarget)}
              >
                永久删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
