// Создаёт индексы для коллекций cache и history.
module.exports = {
  async up(db) {
    await db.collection('cache').createIndex({ date: 1 }, { unique: true });
    await db.collection('history').createIndex({ vacancyId: 1 }, { unique: true });
    await db.collection('history').createIndex({ status: 1 });
    await db.collection('history').createIndex({ at: 1 }, { expireAfterSeconds: 86400 * 180 }); // TTL 6 мес
  },

  async down(db) {
    await db.collection('cache').dropIndex({ date: 1 }).catch(() => {});
    await db.collection('history').dropIndex({ vacancyId: 1 }).catch(() => {});
    await db.collection('history').dropIndex({ status: 1 }).catch(() => {});
    await db.collection('history').dropIndex({ at: 1 }).catch(() => {});
  },
};
