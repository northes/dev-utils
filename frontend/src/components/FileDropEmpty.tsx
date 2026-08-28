import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type Ref,
} from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { Icon } from './shared';
import './FileDropEmpty.css';

export function hasFileTransfer(dataTransfer: DataTransfer | null) {
  return Boolean(
    dataTransfer && (dataTransfer.types.includes('Files') || dataTransfer.files.length),
  );
}

export function useFileDragOver({ enabled = true }: { enabled?: boolean } = {}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const leaveFrame = useRef<number | null>(null);

  const cancelLeave = useCallback(() => {
    if (leaveFrame.current == null) return;
    cancelAnimationFrame(leaveFrame.current);
    leaveFrame.current = null;
  }, []);

  const clear = useCallback(() => {
    cancelLeave();
    depth.current = 0;
    setOver(false);
  }, [cancelLeave]);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }
    window.addEventListener('drop', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragend', clear);
      cancelLeave();
    };
  }, [cancelLeave, clear, enabled]);

  const onDragEnter = useCallback(
    (event: ReactDragEvent) => {
      if (!hasFileTransfer(event.dataTransfer)) return;
      event.preventDefault();
      cancelLeave();
      depth.current += 1;
      setOver(true);
    },
    [cancelLeave],
  );

  const onDragOver = useCallback((event: ReactDragEvent) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current > 0) return;
    cancelLeave();
    leaveFrame.current = requestAnimationFrame(() => {
      leaveFrame.current = null;
      if (depth.current === 0) setOver(false);
    });
  }, [cancelLeave]);

  return {
    over: enabled && over,
    clear,
    dragProps: enabled ? { onDragEnter, onDragOver, onDragLeave } : {},
  };
}

export default function FileDropEmpty({
  icon: Icon,
  title,
  desc,
  actionLabel,
  onChooseFile,
  actionRef,
  over: overProp,
  framed = true,
  announce = true,
  className,
}: {
  icon: Icon;
  title: string;
  desc: string;
  actionLabel: string;
  onChooseFile: () => void;
  actionRef?: Ref<HTMLButtonElement>;
  over?: boolean;
  framed?: boolean;
  announce?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const internal = useFileDragOver({ enabled: overProp === undefined });
  const over = overProp ?? internal.over;
  const release = t('fileDrop.release');

  return (
    <div
      className={cn('file-drop-empty', className)}
      data-over={over ? 'true' : undefined}
      data-framed={framed ? undefined : 'false'}
      {...(overProp === undefined ? internal.dragProps : {})}
    >
      {announce && over ? (
        <span className="sr-only" role="status">
          {release}
        </span>
      ) : null}
      <Icon className="file-drop-empty-icon" size={28} weight="duotone" aria-hidden />
      <strong className="file-drop-empty-title">
        <span className="file-drop-empty-title-idle" aria-hidden={over ? true : undefined}>
          {title}
        </span>
        <span className="file-drop-empty-title-release" aria-hidden={over ? undefined : true}>
          {release}
        </span>
      </strong>
      <span className="file-drop-empty-desc">{desc}</span>
      <Button
        ref={actionRef}
        type="button"
        variant="outline"
        size="sm"
        className="file-drop-empty-action"
        onClick={onChooseFile}
      >
        <UploadSimple data-icon="inline-start" weight="duotone" />
        {actionLabel}
      </Button>
    </div>
  );
}
