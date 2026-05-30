// Создаёт коллекцию resumes и обновляет индексы кэша под resumeId.
module.exports = {
  async up(db) {
    await db.collection('resumes').createIndex({ resumeId: 1 }, { unique: true });

    // Удаляем старые индексы без resumeId, заменяем на новые с resumeId
    try { await db.collection('cacheJudgements').dropIndex('date_1_vacancyId_1'); } catch {}
    try { await db.collection('cacheCoverLetters').dropIndex('vacancyId_1'); } catch {}

    await db.collection('cacheJudgements').createIndex({ date: 1, resumeId: 1, vacancyId: 1 }, { unique: true });
    await db.collection('cacheCoverLetters').createIndex({ resumeId: 1, vacancyId: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection('resumes').drop().catch(() => {});
    await db.collection('cacheJudgements').dropIndex('date_1_resumeId_1_vacancyId_1').catch(() => {});
    await db.collection('cacheCoverLetters').dropIndex('resumeId_1_vacancyId_1').catch(() => {});
  },
};
