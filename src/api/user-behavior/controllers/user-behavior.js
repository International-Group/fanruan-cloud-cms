'use strict';

/**
 * user-behavior controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');
const userBehaviorQueue = require('../utils/user-behavior-queue');

const UID = 'api::user-behavior.user-behavior';
const TRACKING_FIELDS = [
  'user_id',
  'browser_finger_print',
  'address',
  'template_app_id',
  'material_app_id',
  'material_pkg_app_id',
  'reuse_app_id',
  'reuse_pkg_app_id',
  'visual_suite_app_id',
  'connector_app_id',
  'theme_id',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
];

const pickString = (value, maxLength) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const pickFirstString = (input, keys, maxLength) => {
  for (const key of keys) {
    const value = pickString(input[key], maxLength);

    if (value) {
      return value;
    }
  }

  return undefined;
};

const pickTimestamp = (value) => {
  if (value === undefined || value === null || value === '') {
    return String(Date.now());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    const parsedDate = new Date(trimmed);

    if (!Number.isNaN(parsedDate.getTime())) {
      return String(parsedDate.getTime());
    }
  }

  return undefined;
};

module.exports = createCoreController(UID, ({ strapi }) => ({
  async track(ctx) {
    const body = ctx.request.body || {};
    const input =
      body.data && typeof body.data.attributes === 'object'
        ? body.data.attributes
        : body.data && typeof body.data === 'object'
          ? body.data
          : body;
    const evt = pickFirstString(input, ['evt', 'eventName', 'event_name', 'name'], 120);

    if (!evt) {
      return ctx.badRequest('evt is required');
    }

    const time = pickTimestamp(input.time || input.occurredAt);

    if (!time) {
      return ctx.badRequest('time must be a valid timestamp or date');
    }

    const data = {
      uuid: pickString(input.uuid, 120) || crypto.randomUUID(),
      evt,
      time,
    };

    for (const field of TRACKING_FIELDS) {
      data[field] = pickString(input[field], field === 'address' ? 255 : 120);
    }

    data.PN =
      input.PN && typeof input.PN === 'object'
        ? input.PN
        : input.payload && typeof input.payload === 'object'
          ? input.payload
          : undefined;

    const accepted = userBehaviorQueue.enqueue(data);

    if (!accepted) {
      return ctx.serviceUnavailable('Tracking queue is full');
    }

    ctx.status = 202;
    ctx.body = {
      data: {
        accepted: true,
        uuid: data.uuid,
        queued: userBehaviorQueue.size(),
      },
    };
  },
}));
