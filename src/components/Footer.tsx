export default function Footer() {
  return (
    <footer className="w-full border-t border-border bg-muted/30 py-2">
      <div className="px-4 md:px-6">
        <div className="flex flex-col items-center justify-between gap-2 text-[11px] text-muted-foreground md:flex-row">
          <div>
            Audacity Web — 基于浏览器的开源音频编辑器 ·{' '}
            <span className="text-foreground">GPLv3</span>
          </div>
          <div className="flex items-center gap-4">
            <span>本项目为独立 Web 重构实现，非 Audacity 官方产品</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
