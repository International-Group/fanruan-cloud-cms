'use strict';

const UID = 'api::user-behavior.user-behavior';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 10000;
const DEFAULT_MAX_RETRIES = 3;

let strapiInstance;
let timer;
let processing = false;
const queue = [];

const options = {
  intervalMs: DEFAULT_INTERVAL_MS,
  batchSize: DEFAULT_BATCH_SIZE,
  maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
  maxRetries: DEFAULT_MAX_RETRIES,
};

const getErrorMessage = (error) => {
  if (!error) {
    return 'Unknown error';
  }

  return error.message || String(error);
};

const shouldRetry = (error) => {
  const message = getErrorMessage(error).toLowerCase();

  return !message.includes('unique') && !message.includes('duplicate');
};

const persist = async (entry) => {
  await strapiInstance.service(UID).create({ data: entry.data });
};

const processQueue = async () => {
  if (processing || !strapiInstance || queue.length === 0) {
    return;
  }

  processing = true;
  const batch = queue.splice(0, options.batchSize);

  try {
    const results = await Promise.allSettled(batch.map(persist));
    let failedCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        return;
      }

      failedCount += 1;
      const entry = batch[index];
      const attempts = entry.attempts + 1;
      const error = result.reason;

      if (attempts <= options.maxRetries && shouldRetry(error)) {
        queue.push({
          ...entry,
          attempts,
        });
        return;
      }

      strapiInstance.log.error(
        `[user-behavior] Failed to persist tracking event after ${attempts} attempt(s): ${getErrorMessage(error)}`
      );
    });

    if (failedCount > 0) {
      strapiInstance.log.warn(
        `[user-behavior] ${failedCount}/${batch.length} queued tracking event(s) failed in current batch`
      );
    }
  } finally {
    processing = false;
  }
};

const start = (strapi, config = {}) => {
  strapiInstance = strapi;
  Object.assign(options, config);

  if (timer) {
    return;
  }

  timer = setInterval(processQueue, options.intervalMs);
  timer.unref?.();
  strapiInstance.log.info(
    `[user-behavior] In-memory tracking queue started: interval=${options.intervalMs}ms batchSize=${options.batchSize} maxQueueSize=${options.maxQueueSize}`
  );
};

const stop = async () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }

  await processQueue();
  strapiInstance = undefined;
};

const enqueue = (data) => {
  if (queue.length >= options.maxQueueSize) {
    return false;
  }

  queue.push({
    data,
    attempts: 0,
  });

  setImmediate(processQueue);

  return true;
};

const size = () => queue.length;

module.exports = {
  enqueue,
  size,
  start,
  stop,
};
