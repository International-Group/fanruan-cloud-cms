'use strict';
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { S3Client } = require('@aws-sdk/client-s3');
module.exports = t => {
  const state = { objects: new Map(), calls: [], private: true, failPut: false, corruptGet: false };
  t.mock.method(S3Client.prototype, 'send', async function(command) {
    const input = command.input; const action = command.constructor.name; state.calls.push({ action, input });
    const key = `${input.Bucket}/${input.Key}`;
    if (action === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: { BlockPublicAcls: state.private, IgnorePublicAcls: state.private, BlockPublicPolicy: state.private, RestrictPublicBuckets: state.private } };
    if (action === 'PutObjectCommand') {
      assert.equal(input.ACL, undefined, 'Gallery must never inherit public-read');
      const chunks = []; for await (const chunk of input.Body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks); assert.equal(bytes.length, input.ContentLength);
      assert.equal(input.ChecksumSHA256, createHash('sha256').update(bytes).digest('base64'));
      state.objects.set(key, bytes);
      if (state.failPut) throw new Error('Simulated lost S3 response with credentials detail');
      return { ETag: 'test-etag' };
    }
    if (action === 'GetObjectCommand') {
      if (!state.objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: Readable.from(state.corruptGet ? Buffer.from('corrupted') : state.objects.get(key)) };
    }
    if (action === 'DeleteObjectCommand') { state.objects.delete(key); return {}; }
    throw new Error(`Unexpected S3 command ${action}; real AWS calls are forbidden in tests`);
  });
  return state;
};
