import {
  evaluatePipeline,
  type PipelineWorkerRequest,
  type PipelineWorkerResponse,
} from '../components/JsonPipelineEngine';

type WorkerScope = {
  onmessage: (event: MessageEvent<PipelineWorkerRequest>) => void;
  postMessage: (message: PipelineWorkerResponse) => void;
};
const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const { id, source, rules } = event.data;
  workerScope.postMessage({ id, result: evaluatePipeline(source, rules) });
};
