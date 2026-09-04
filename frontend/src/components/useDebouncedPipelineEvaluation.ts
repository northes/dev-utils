import { useEffect, useRef, useState } from 'react';
import {
  emptyPipelineEvaluation,
  evaluatePipeline,
  type PipelineEvaluation,
  type PipelineItem,
  type PipelineWorkerRequest,
  type PipelineWorkerResponse,
} from './JsonPipelineEngine';

export function useDebouncedPipelineEvaluation(
  enabled: boolean,
  source: string,
  rules: PipelineItem[],
  delay = 150,
) {
  const [resolved, setResolved] = useState<PipelineEvaluation>(() => emptyPipelineEvaluation());
  const revision = useRef(0);
  const request = useRef(0);
  const timer = useRef<number | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );
  useEffect(() => {
    const current = ++revision.current;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!enabled) {
      worker.current?.terminate();
      worker.current = null;
      setResolved(emptyPipelineEvaluation());
      return;
    }
    setResolved(emptyPipelineEvaluation(rules));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const commit = (value: PipelineEvaluation) => {
        if (current === revision.current) setResolved(value);
      };
      const fallback = () => commit(evaluatePipeline(source, rules));
      try {
        const instance =
          worker.current ??
          new Worker(new URL('../utils/jsonPipeline.worker.ts', import.meta.url), {
            type: 'module',
          });
        worker.current = instance;
        const id = ++request.current;
        instance.onmessage = (event: MessageEvent<PipelineWorkerResponse>) => {
          if (event.data.id !== id) return;
          commit(event.data.result);
        };
        instance.onerror = () => {
          if (current !== revision.current) return;
          instance.terminate();
          worker.current = null;
          fallback();
        };
        const message: PipelineWorkerRequest = { id, source, rules };
        instance.postMessage(message);
      } catch {
        fallback();
      }
    }, delay);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, source, rules, delay]);
  return enabled ? resolved : emptyPipelineEvaluation(rules);
}
