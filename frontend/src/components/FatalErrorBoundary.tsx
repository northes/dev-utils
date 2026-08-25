import React from 'react';
import { ArrowsClockwise, Bug } from '@phosphor-icons/react';
import { Window } from '@wailsio/runtime';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

type FatalErrorBoundaryProps = { children: React.ReactNode };
type FatalErrorBoundaryState = { error: Error | null };

const AUTO_RELOAD_KEY = 'devutils.fatal-auto-reload';

function isChunkLoadError(error: Error) {
  return /chunk|dynamically imported module|failed to fetch/i.test(error.message);
}

function reload(force: boolean) {
  const request = force ? Window.ForceReload() : Window.Reload();
  void request.catch(() => window.location.reload());
}

function CrashScreen({ error, onReload }: { error: Error; onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <main className="flex h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="flex w-full max-w-[420px] flex-col items-center text-center">
        <Bug size={34} weight="duotone" className="mb-4 text-destructive" />
        <h1 className="text-base font-semibold">{t('crash.title')}</h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('crash.description')}</p>
        <Button className="mt-6" onClick={onReload}>
          <ArrowsClockwise data-icon="inline-start" size={15} weight="duotone" />
          {t('crash.reload')}
        </Button>
        <details className="mt-6 w-full text-left text-[10px] text-muted-foreground">
          <summary className="cursor-pointer text-center">{t('crash.details')}</summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3">
            {error.message}
          </pre>
        </details>
      </section>
    </main>
  );
}

export class FatalErrorBoundary extends React.Component<
  FatalErrorBoundaryProps,
  FatalErrorBoundaryState
> {
  state: FatalErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): FatalErrorBoundaryState {
    return { error };
  }

  componentDidMount() {
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error) {
    if (!isChunkLoadError(error) || sessionStorage.getItem(AUTO_RELOAD_KEY)) return;
    sessionStorage.setItem(AUTO_RELOAD_KEY, '1');
    reload(true);
  }

  handleGlobalError = (event: ErrorEvent) => {
    if (event.error instanceof Error) this.setState({ error: event.error });
  };

  handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    this.setState({ error });
  };

  render() {
    if (this.state.error) {
      return <CrashScreen error={this.state.error} onReload={() => reload(false)} />;
    }
    return this.props.children;
  }
}

export function FatalErrorBoundaryRoot({ children }: FatalErrorBoundaryProps) {
  return <FatalErrorBoundary>{children}</FatalErrorBoundary>;
}
