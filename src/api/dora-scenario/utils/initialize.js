'use strict';

const taxonomies = require('./taxonomies');

function labelLanguage(code) {
  const locale = new Intl.Locale(code);
  return locale.language === 'zh' && locale.maximize().script === 'Hant'
    ? 'zh-Hant'
    : locale.language;
}

async function reserveDoraTables(strapi) {
  // A previous release would otherwise drop newly tracked tables during rollback.
  const key = { type: 'core', key: 'persisted_tables' };
  const persisted = (await strapi.store.get(key)) ?? [];
  const reserved = new Set(persisted.map(table => typeof table === 'string' ? table : table.name));
  const newTables = strapi.db.schema.schema.tables
    .filter(({ name }) => name.startsWith('dora_') && !reserved.has(name))
    .map(({ name }) => ({ name }));
  if (newTables.length > 0) {
    await strapi.store.set({ ...key, value: [...persisted, ...newTables] });
  }
}

async function initializeDoraLibrary(strapi) {
  const store = strapi.store({ type: 'core', name: 'dora-library' });
  const i18n = strapi.plugin('i18n').service('locales');
  const defaultLocale = await i18n.getDefaultLocale();
  const defaultLanguage = labelLanguage(defaultLocale);
  const locales = await i18n.find();
  const fields = ['name', 'slug'];

  await strapi.db.transaction(async () => {
    const initialized = await store.get({ key: 'initialized' });
    const seeded = (await store.get({ key: 'localized_locales' })) ?? [];
    const pending = locales.filter(({ code }) => !seeded.includes(code));
    if (initialized && pending.length === 0) return;
    if (!initialized) await reserveDoraTables(strapi);
    const localizeDefault = !seeded.includes(defaultLocale);

    for (const [uid, labels] of Object.entries(taxonomies)) {
      const documents = strapi.documents(uid);
      const source = await documents.findMany({ locale: defaultLocale, fields });
      const bySlug = new Map(source.map(entry => [entry.slug, entry]));
      const sourceNames = new Set(source.map(entry => entry.name));

      for (const [slug, translations] of Object.entries(labels)) {
        const entry = bySlug.get(slug);
        const name = translations[defaultLanguage] ?? translations.zh;
        if (!entry && !initialized && !sourceNames.has(name) && !sourceNames.has(translations.zh)) {
          const created = await documents.create({ locale: defaultLocale, data: { name, slug } });
          bySlug.set(slug, created);
          sourceNames.add(name);
        } else if (localizeDefault && entry?.name === translations.zh && !sourceNames.has(name)) {
          // Strapi moves legacy entries into the default locale. Only rename untouched starter labels.
          await documents.update({ documentId: entry.documentId, locale: defaultLocale, data: { name } });
          sourceNames.delete(entry.name);
          sourceNames.add(name);
        }
      }

      for (const { code } of pending) {
        if (code === defaultLocale) continue;
        const language = labelLanguage(code);
        const existing = await documents.findMany({ locale: code, fields });
        const documentIds = new Set(existing.map(entry => entry.documentId));
        const slugs = new Set(existing.map(entry => entry.slug));
        const names = new Set(existing.map(entry => entry.name));

        for (const [slug, translations] of Object.entries(labels)) {
          const entry = bySlug.get(slug);
          const name = translations[language];
          if (!name || !entry || documentIds.has(entry.documentId) || slugs.has(slug) || names.has(name)) continue;
          await documents.update({ documentId: entry.documentId, locale: code, data: { name, slug } });
        }
      }
    }

    await store.set({ key: 'localized_locales', value: [...seeded, ...pending.map(({ code }) => code)] });
    if (!initialized) await store.set({ key: 'initialized', value: true });
  });
}

module.exports = initializeDoraLibrary;
