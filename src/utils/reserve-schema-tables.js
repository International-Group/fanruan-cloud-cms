'use strict';

async function reserveSchemaTables(strapi, prefix) {
  // Keep newly tracked tables when an earlier application version is restored.
  const key = { type: 'core', key: 'persisted_tables' };
  const persisted = (await strapi.store.get(key)) ?? [];
  const reserved = new Set(persisted.map(table => typeof table === 'string' ? table : table.name));
  const added = strapi.db.schema.schema.tables
    .filter(({ name }) => name.startsWith(prefix) && !reserved.has(name))
    .map(({ name }) => name);
  if (added.length) await strapi.store.set({ ...key, value: [...persisted, ...added] });
}

module.exports = reserveSchemaTables;
