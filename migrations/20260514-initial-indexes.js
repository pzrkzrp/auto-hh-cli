// Создаёт индексы для коллекций cachePages, cacheFull, cacheJudgements, cacheCoverLetters и history.
module.exports = {
  async up(db) {
    await db.collection('cachePages').createIndex({ date: 1, page: 1 }, { unique: true });
    await db.collection('cacheFull').createIndex({ vacancyId: 1 }, { unique: true });
    await db.collection('cacheJudgements').createIndex({ date: 1, vacancyId: 1 }, { unique: true });
    await db.collection('cacheCoverLetters').createIndex({ vacancyId: 1 }, { unique: true });
    await db.collection('history').createIndex({ vacancyId: 1 }, { unique: true });
    await db.collection('history').createIndex({ status: 1 });
    await db.collection('history').createIndex({ at: 1 }, { expireAfterSeconds: 86400 * 180 });
  },

  async down(db) {
    for (const coll of ['cachePages', 'cacheFull', 'cacheJudgements', 'cacheCoverLetters']) {
      await db.collection(coll).drop().catch(() => {});
    }
    await db.collection('history').drop().catch(() => {});
  },
};
