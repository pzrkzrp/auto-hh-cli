// Логика отбора вакансий по критериям из config.filter.
function lower(s) { return (s || '').toString().toLowerCase(); }

const CAPITALS = new Set(['1', '2']); // hh: 1 = Москва, 2 = Санкт-Петербург

function detectWorkFormat(vacancy) {
  const fromField = (vacancy.work_format || []).map(s => String(s).toUpperCase());
  if (fromField.length) {
    return {
      remote: fromField.some(s => s.includes('REMOTE') || s.includes('УДАЛ')),
      hybrid: fromField.some(s => s.includes('HYBRID') || s.includes('ГИБРИД')),
      onSite: fromField.some(s => s.includes('ON_SITE') || s.includes('OFFICE') || s.includes('FIELD') || s.includes('МЕСТ')),
    };
  }
  // Fallback: по description/schedule.
  const text = [vacancy.schedule?.name, vacancy.description, vacancy.name]
    .map(lower).join(' ');
  return {
    remote: /удал[её]нн|remote|из дома/.test(text),
    hybrid: /гибрид|hybrid/.test(text),
    onSite: /на месте|в офисе|офисн/.test(text),
  };
}

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

  // Локация + формат работы:
  // - Москва/СПб → remote или on-site/гибрид
  // - другие регионы → только remote
  if (filter.locationRule !== false) {
    const areaId = String(vacancy.area?.id || '').replace(/\D/g, '');
    const isCapital = CAPITALS.has(areaId);
    const wf = detectWorkFormat(vacancy);
    const known = wf.remote || wf.hybrid || wf.onSite;
    if (known && !isCapital && !wf.remote) {
      return { ok: false, reason: 'region: not remote' };
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

export { vacancyMatchesFilter };
