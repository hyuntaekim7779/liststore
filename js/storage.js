/**
 * Storage adapter (localStorage based).
 *
 * 추후 Azure Table Storage 등 원격 저장소로 바꾸려면 아래 인터페이스만 동일하게
 * 구현한 어댑터를 만들어서 window.Storage 로 노출하면 됩니다.
 *   - getStores(meal): Promise<Store[]>
 *   - saveStores(meal, stores): Promise<void>
 *   - getVote(meal): Promise<Vote|null>
 *   - saveVote(meal, vote): Promise<void>
 *   - clearVote(meal): Promise<void>
 *
 * Azure Table Storage 어댑터 예시는 README.md 참고.
 */
(function () {
  const KEY_STORES = (meal) => `ls.stores.${meal}`;
  const KEY_VOTE   = (meal) => `ls.vote.${meal}`;

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  const Storage = {
    async getStores(meal) {
      return safeParse(localStorage.getItem(KEY_STORES(meal)), []);
    },
    async saveStores(meal, stores) {
      localStorage.setItem(KEY_STORES(meal), JSON.stringify(stores));
    },
    async getVote(meal) {
      return safeParse(localStorage.getItem(KEY_VOTE(meal)), null);
    },
    async saveVote(meal, vote) {
      localStorage.setItem(KEY_VOTE(meal), JSON.stringify(vote));
    },
    async clearVote(meal) {
      localStorage.removeItem(KEY_VOTE(meal));
    },
  };

  window.Storage = Storage;
})();
