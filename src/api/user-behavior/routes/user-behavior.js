'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/user-behaviors/track',
      handler: 'user-behavior.track',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/user-behavior/track',
      handler: 'user-behavior.track',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/user-behaviors',
      handler: 'user-behavior.track',
      config: {
        auth: false,
      },
    },
  ],
};
