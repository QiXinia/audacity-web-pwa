import { NavLink } from 'react-router-dom';
import { FolderOpen, Settings, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { path: '/', label: '工程', icon: FolderOpen },
  { path: '/settings', label: '设置', icon: Settings },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md">
      <div className="flex h-11 items-center justify-between px-3">
        <div className="flex items-center gap-8">
          <NavLink to="/" className="flex items-center gap-2 font-semibold text-foreground">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Headphones className="size-4" />
            </div>
            <span className="text-base">Audacity Web</span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )
                  }
                >
                  <Icon className="size-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">v0.1.0 · 增强编辑版</span>
        </div>
      </div>
    </header>
  );
}
