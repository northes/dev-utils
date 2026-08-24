import { useEffect, useRef, useState } from 'react';
import {
  emptyWorkflowEvaluation,
  evaluateWorkflow,
  type WorkflowEvaluation,
  type WorkflowItem,
  type WorkflowWorkerRequest,
  type WorkflowWorkerResponse,
} from './JsonWorkflowEngine';

export function useDebouncedWorkflowEvaluation(
  enabled: boolean,
  source: string,
  rules: WorkflowItem[],
  delay = 150,
) {
  const [resolved, setResolved] = useState<WorkflowEvaluation>(() => emptyWorkflowEvaluation());
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
      setResolved(emptyWorkflowEvaluation());
      return;
    }
    setResolved(emptyWorkflowEvaluation(rules));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const commit = (value: WorkflowEvaluation) => {
        if (current === revision.current) setResolved(value);
      };
      const fallback = () => commit(evaluateWorkflow(source, rules));
      try {
        const instance =
          worker.current ??
          new Worker(new URL('../utils/jsonWorkflow.worker.ts', import.meta.url), {
            type: 'module',
          });
        worker.current = instance;
        const id = ++request.current;
        instance.onmessage = (event: MessageEvent<WorkflowWorkerResponse>) => {
          if (event.data.id !== id) return;
          commit(event.data.result);
        };
        instance.onerror = () => {
          if (current !== revision.current) return;
          instance.terminate();
          worker.current = null;
          fallback();
        };
        const message: WorkflowWorkerRequest = { id, source, rules };
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
  return enabled ? resolved : emptyWorkflowEvaluation(rules);
}
