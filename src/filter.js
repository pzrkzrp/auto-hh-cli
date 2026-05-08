// Логика отбора вакансий по критериям из config.filter.
function lower(s) { return (s || '').toString().toLowerCase(); }

function vacancyMatchesFilter(vacancy, filter) {
  if (!vacancy) return { ok: false, reason: 'no vacancy' };

  if (filter.excludeArchived && vacancy.archived) {
    return { ok: false, reason: 'archived' };
  }

  const employerName = lower(vacancy.employer?.name);
  if (filter.excludedCompanies?.some(c => employerName.includes(lower(c)))) {
    return { ok: false, reason: 'excluded employer' };
  }

  const haystack = [
    vacancy.name,
    vacancy.description,
    vacancy.snippet?.requirement,
    vacancy.snippet?.responsibility,
    ...(vacancy.key_skills || []).map(s => s.name),
  ].map(lower).join(' ');

  if (filter.excludedKeywords?.some(k => haystack.includes(lower(k)))) {
    return { ok: false, reason: 'excluded keyword' };
  }

  // Минимальная зарплата (если указана у вакансии в RUR).
  if (filter.minSalaryRub && vacancy.salary) {
    const s = vacancy.salary;
    const value = s.from || s.to;
    if (value && s.currency === 'RUR' && value < filter.minSalaryRub) {
      return { ok: false, reason: `salary below ${filter.minSalaryRub}` };
    }
  }

  // Соответствие требуемым навыкам — хотя бы один из списка.
  let matchedSkills = [];
  if (filter.requiredSkills?.length) {
    matchedSkills = filter.requiredSkills.filter(s => haystack.includes(lower(s)));
    if (matchedSkills.length === 0) {
      return { ok: false, reason: 'no required skills matched' };
    }
  }

  return { ok: true, matchedSkills };
}

module.exports = { vacancyMatchesFilter };
