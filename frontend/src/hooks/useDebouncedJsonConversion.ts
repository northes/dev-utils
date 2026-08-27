import { useEffect, useRef, useState } from 'react';
import type { JsonConvertFormat } from '../lib/json-converter';
import type {
  JsonConvertWorkerError,
  JsonConvertWorkerRequest,
  JsonConvertWorkerResponse,
} from '../utils/jsonConvert.worker';

export type JsonConversionState =
  | { status: 'idle'; revision: number }
  | { status: 'pending'; revision: number; input: string; format: JsonConvertFormat }
  | { status: 'empty'; revision: number; input: string; format: JsonConvertFormat }
  | {
      status: 'ok';
      revision: number;
      input: string;
      format: JsonConvertFormat;
      output: string;
    }
  | {
      status: 'error';
      revision: number;
      input: string;
      format: JsonConvertFormat;
      error: JsonConvertWorkerError;
    };

const DEBOUNCE_MS = 150;

function idleState(revision: number): JsonConversionState {
  return { status: 'idle', revision };
}

function pendingState(
  revision: number,
  input: string,
  format: JsonConvertFormat,
): JsonConversionState {
  return { status: 'pending', revision, input, format };
}

export function useDebouncedJsonConversion(
  enabled: boolean,
  input: string,
  format: JsonConvertFormat,
): JsonConversionState {
  const [state, setState] = useState<JsonConversionState>(() => idleState(0));
  const revision = useRef(0);
  const timer = useRef<number | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    const currentRevision = ++revision.current;

    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    worker.current?.terminate();
    worker.current = null;

    if (!enabled) {
      setState(idleState(currentRevision));
      return;
    }

    if (!input.trim()) {
      setState({ status: 'empty', revision: currentRevision, input, format });
      return;
    }

    setState(pendingState(currentRevision, input, format));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (currentRevision !== revision.current) return;

      let instance: Worker;
      try {
        instance = new Worker(new URL('../utils/jsonConvert.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.current = instance;
      } catch {
        if (currentRevision === revision.current)
          setState({
            status: 'error',
            revision: currentRevision,
            input,
            format,
            error: { code: 'workerError', params: {} },
          });
        return;
      }

      const finish = () => {
        if (worker.current !== instance) return;
        instance.terminate();
        worker.current = null;
      };
      instance.onmessage = (event: MessageEvent<JsonConvertWorkerResponse>) => {
        if (event.data.revision !== revision.current || event.data.revision !== currentRevision)
          return;
        finish();
        if (event.data.status === 'ok')
          setState({
            status: 'ok',
            revision: currentRevision,
            input,
            format,
            output: event.data.output,
          });
        else
          setState({
            status: 'error',
            revision: currentRevision,
            input,
            format,
            error: event.data.error,
          });
      };
      instance.onerror = () => {
        if (currentRevision !== revision.current) return;
        finish();
        setState({
          status: 'error',
          revision: currentRevision,
          input,
          format,
          error: { code: 'workerError', params: {} },
        });
      };

      const request: JsonConvertWorkerRequest = { revision: currentRevision, input, format };
      try {
        instance.postMessage(request);
      } catch {
        if (currentRevision !== revision.current) return;
        finish();
        setState({
          status: 'error',
          revision: currentRevision,
          input,
          format,
          error: { code: 'workerError', params: {} },
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      worker.current?.terminate();
      worker.current = null;
    };
  }, [enabled, input, format]);

  if (!enabled) return idleState(revision.current);
  if (!input.trim()) {
    if (state.status === 'empty' && state.input === input && state.format === format) return state;
    return { status: 'empty', revision: revision.current + 1, input, format };
  }
  if (state.status !== 'idle' && state.input === input && state.format === format) return state;
  return pendingState(revision.current + 1, input, format);
}
