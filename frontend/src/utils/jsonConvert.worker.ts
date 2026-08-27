import {
  convertJson,
  JsonConverterError,
  type JsonConvertErrorCode,
  type JsonConvertFormat,
} from '../lib/json-converter';

export type JsonConvertWorkerRequest = {
  revision: number;
  input: string;
  format: JsonConvertFormat;
};

export type JsonConvertWorkerError = {
  code: JsonConvertErrorCode | 'workerError';
  params: Record<string, string>;
};

export type JsonConvertWorkerResponse =
  | {
      revision: number;
      status: 'ok';
      output: string;
    }
  | {
      revision: number;
      status: 'error';
      error: JsonConvertWorkerError;
    };

type WorkerScope = {
  onmessage: (event: MessageEvent<JsonConvertWorkerRequest>) => void;
  postMessage: (message: JsonConvertWorkerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;

function serializeError(error: unknown): JsonConvertWorkerError {
  if (error instanceof JsonConverterError) {
    return { code: error.code, params: { ...error.params } };
  }
  return { code: 'workerError', params: {} };
}

workerScope.onmessage = (event) => {
  const { revision, input, format } = event.data;
  try {
    workerScope.postMessage({
      revision,
      status: 'ok',
      output: convertJson(input, format),
    });
  } catch (error) {
    workerScope.postMessage({
      revision,
      status: 'error',
      error: serializeError(error),
    });
  }
};
