/**
 * Stores module — CRUD for restaurants per meal type (lunch/dinner).
 */
(function () {
  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  const Stores = {
    cache: { lunch: [], dinner: [] },

    async load(meal) {
      this.cache[meal] = await window.Storage.getStores(meal);
      return this.cache[meal];
    },

    async add(meal, partial) {
      const store = {
        id: uid(),
        name: partial.name.trim(),
        url: (partial.url || '').trim(),
        address: (partial.address || '').trim(),
        lat: partial.lat != null && partial.lat !== '' ? Number(partial.lat) : null,
        lng: partial.lng != null && partial.lng !== '' ? Number(partial.lng) : null,
        memo: (partial.memo || '').trim(),
        placeId: partial.placeId ? String(partial.placeId).trim() : null,
        phone: partial.phone ? String(partial.phone).trim() : null,
        category: partial.category ? String(partial.category).trim() : null,
        createdAt: Date.now(),
      };
      this.cache[meal].push(store);
      await window.Storage.saveStores(meal, this.cache[meal]);
      return store;
    },

    async remove(meal, id) {
      this.cache[meal] = this.cache[meal].filter((s) => s.id !== id);
      await window.Storage.saveStores(meal, this.cache[meal]);
    },

    get(meal) {
      return this.cache[meal] || [];
    },

    getById(meal, id) {
      return this.get(meal).find((s) => s.id === id) || null;
    },

    /** Pick N unique random stores. */
    pickRandom(meal, n) {
      const arr = [...this.get(meal)];
      const out = [];
      while (arr.length && out.length < n) {
        const idx = Math.floor(Math.random() * arr.length);
        out.push(arr.splice(idx, 1)[0]);
      }
      return out;
    },
  };

  window.Stores = Stores;
})();
