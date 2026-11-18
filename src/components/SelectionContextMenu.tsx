import { useEffect, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SelectionRippleMode } from '@/lib/selectionEdit';
import type { SelectionPasteMode } from '@/lib/selectionPaste';

export type SelectionContextEditOperation = 'cut' | 'delete';

interface SelectionContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  hasClipboard: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: (mode?: SelectionPasteMode) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: (operation: SelectionContextEditOperation, mode: SelectionRippleMode) => void;
  onSplit: () => void;
  onDisjoin: () => void;
  onJoin: () => void;
}

export function SelectionContextMenu({
  open,
  x,
  y,
  hasClipboard,
  disabled = false,
  onOpenChange,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onEdit,
  onSplit,
  onDisjoin,
  onJoin,
}: SelectionContextMenuProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    anchorRef.current?.style.setProperty('left', `${x}px`);
    anchorRef.current?.style.setProperty('top', `${y}px`);
  }, [x, y]);

  const pasteItems: Array<{ mode: SelectionPasteMode; id: string; label: string }> = [
    { mode: 'overlap', id: 'selection-paste-overlap', label: 'Paste and overlap' },
    { mode: 'per-track', id: 'selection-paste-per-track', label: 'Paste and make room on this track' },
    { mode: 'all-tracks', id: 'selection-paste-all-tracks', label: 'Paste and make room on all tracks' },
  ];
  const editModes: Array<{ mode: SelectionRippleMode; label: string }> = [
    { mode: 'leave-gap', label: 'leave gap' },
    { mode: 'per-clip', label: 'close gap' },
    { mode: 'per-track', label: 'close gap on this track' },
    { mode: 'all-tracks', label: 'close gap on all tracks' },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={anchorRef}
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed z-0 size-px opacity-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="selection-context-menu"
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        className="w-72"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem data-testid="selection-context-cut" disabled={disabled} onClick={onCut}>Cut</DropdownMenuItem>
        <DropdownMenuItem data-testid="selection-context-copy" disabled={disabled} onClick={onCopy}>Copy</DropdownMenuItem>
        <DropdownMenuItem
          data-testid="selection-context-paste"
          disabled={disabled || !hasClipboard}
          onClick={() => onPaste()}
        >
          Paste
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="selection-context-duplicate" disabled={disabled} onClick={onDuplicate}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem data-testid="selection-context-delete" disabled={disabled} onClick={onDelete}>Delete</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="selection-context-cut-menu" disabled={disabled}>Cut and…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {editModes.map(({ mode, label }) => (
              <DropdownMenuItem
                key={mode}
                data-testid={`selection-cut-${mode}`}
                disabled={disabled}
                onClick={() => onEdit('cut', mode)}
              >
                Cut and {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            data-testid="selection-context-paste-menu"
            disabled={disabled || !hasClipboard}
          >
            Paste and…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80">
            {pasteItems.map(({ mode, id, label }) => (
              <DropdownMenuItem
                key={mode}
                data-testid={id}
                disabled={disabled || !hasClipboard}
                onClick={() => onPaste(mode)}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="selection-context-delete-menu" disabled={disabled}>Delete and…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            {editModes.map(({ mode, label }) => (
              <DropdownMenuItem
                key={mode}
                data-testid={`selection-delete-${mode}`}
                disabled={disabled}
                onClick={() => onEdit('delete', mode)}
              >
                Delete and {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="selection-split" disabled={disabled} onClick={onSplit}>Split</DropdownMenuItem>
        <DropdownMenuItem data-testid="selection-disjoin" disabled={disabled} onClick={onDisjoin}>Split at silences</DropdownMenuItem>
        <DropdownMenuItem data-testid="selection-join" disabled={disabled} onClick={onJoin}>Join</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
