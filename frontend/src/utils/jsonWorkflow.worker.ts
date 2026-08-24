import {
  evaluateWorkflow,
  type WorkflowWorkerRequest,
  type WorkflowWorkerResponse,
} from '../components/JsonWorkflowEngine';

type WorkerScope = {
  onmessage: (event: MessageEvent<WorkflowWorkerRequest>) => void;
  postMessage: (message: WorkflowWorkerResponse) => void;
};
const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const { id, source, rules } = event.data;
  workerScope.postMessage({ id, result: evaluateWorkflow(source, rules) });
};
