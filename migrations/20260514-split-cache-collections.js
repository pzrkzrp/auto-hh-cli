// Переносит данные из единой коллекции cache в отдельные:
// cachePages, cacheFull, cacheJudgements, cacheCoverLetters.
module.exports = {
  async up(db) {
    const oldDocs = await db.collection('cache').find({}).toArray();
    if (!oldDocs.length) {
      console.log('No documents in cache collection — nothing to migrate');
      return;
    }

    let totalPages = 0, totalFull = 0, totalJudgements = 0, totalCoverLetters = 0;

    for (const doc of oldDocs) {
      const { date, pages, fullById, judgements, coverLetters } = doc;
      if (!date) continue;

      // pages → cachePages
      if (pages) {
        const pageEntries = Object.entries(pages).map(([page, items]) => ({
          date, page: Number(page), items,
        }));
        if (pageEntries.length) {
          await db.collection('cachePages').insertMany(pageEntries, { ordered: false }).catch(() => {});
          totalPages += pageEntries.length;
        }
      }

      // fullById → cacheFull
      if (fullById) {
        const fullEntries = Object.entries(fullById).map(([vacancyId, full]) => ({
          date, vacancyId, full,
        }));
        if (fullEntries.length) {
          await db.collection('cacheFull').insertMany(fullEntries, { ordered: false }).catch(() => {});
          totalFull += fullEntries.length;
        }
      }

      // judgements → cacheJudgements
      if (judgements) {
        const judgeEntries = Object.entries(judgements).map(([vacancyId, j]) => ({
          date, vacancyId,
          score: j.score,
          fit: j.fit,
          reason: j.reason,
          redFlags: j.redFlags || [],
        }));
        if (judgeEntries.length) {
          await db.collection('cacheJudgements').insertMany(judgeEntries, { ordered: false }).catch(() => {});
          totalJudgements += judgeEntries.length;
        }
      }

      // coverLetters → cacheCoverLetters
      if (coverLetters) {
        const coverEntries = Object.entries(coverLetters).map(([vacancyId, letter]) => ({
          date, vacancyId, letter,
        }));
        if (coverEntries.length) {
          await db.collection('cacheCoverLetters').insertMany(coverEntries, { ordered: false }).catch(() => {});
          totalCoverLetters += coverEntries.length;
        }
      }
    }

    // Индексы
    await db.collection('cachePages').createIndex({ date: 1, page: 1 }, { unique: true }).catch(() => {});
    await db.collection('cacheFull').createIndex({ vacancyId: 1 }, { unique: true }).catch(() => {});
    await db.collection('cacheJudgements').createIndex({ date: 1, vacancyId: 1 }, { unique: true }).catch(() => {});
    await db.collection('cacheCoverLetters').createIndex({ vacancyId: 1 }, { unique: true }).catch(() => {});

    console.log(`Migrated: ${totalPages} pages, ${totalFull} fullById, ${totalJudgements} judgements, ${totalCoverLetters} cover letters`);

    // Опционально: удаляем старую коллекцию
    // await db.collection('cache').drop();
  },

  async down(db) {
    for (const coll of ['cachePages', 'cacheFull', 'cacheJudgements', 'cacheCoverLetters']) {
      await db.collection(coll).drop().catch(() => {});
    }
    console.log('Dropped all split collections');
  },
};
