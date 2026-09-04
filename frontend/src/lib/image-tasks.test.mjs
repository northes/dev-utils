import assert from 'node:assert/strict';
import test from 'node:test';
import { applyImageTaskSnapshot } from './image-tasks.ts';

const empty = { revision: 0, tasks: [] };
const queued = {
  revision: 3,
  tasks: ['a', 'b', 'c'].map((id) => ({ id, status: 'queued', path: `${id}.tar` })),
};
const finished = {
  revision: 6,
  tasks: queued.tasks.map((task) => ({ ...task, status: 'success' })),
};

test('创建事件未收到时，导出响应仍显示全部任务', () => {
  const result = { started: 3, snapshot: queued };
  const state = applyImageTaskSnapshot(empty, result.snapshot);
  assert.equal(state.tasks.length, result.started);
  assert.deepEqual(state.tasks.map((task) => task.id), ['a', 'b', 'c']);
});

test('晚到的初始查询和乱序事件不会清空或回退任务', () => {
  let state = applyImageTaskSnapshot(null, queued);
  state = applyImageTaskSnapshot(state, empty);
  state = applyImageTaskSnapshot(state, finished);
  state = applyImageTaskSnapshot(state, queued);
  assert.equal(state, finished);
});

test('任务在导出响应返回前完成时，保留较新的完成状态', () => {
  const state = applyImageTaskSnapshot(finished, queued);
  assert.equal(state, finished);
});

test('相同版本不重复更新，更高版本可以清理过期任务', () => {
  assert.equal(applyImageTaskSnapshot(queued, structuredClone(queued)), queued);
  const pruned = { revision: 7, tasks: [] };
  assert.equal(applyImageTaskSnapshot(finished, pruned), pruned);
});
