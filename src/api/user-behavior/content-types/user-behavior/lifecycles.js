'use strict';

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    if (!data.time) {
      data.time = String(Date.now());
    }
  },
};
