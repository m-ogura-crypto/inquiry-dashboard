export default async function handler(req, res) {
  const KINTONE_SUBDOMAIN = 'wellnest-home';
  const KINTONE_APP_ID = '97';
  const KINTONE_API_TOKEN = process.env.KINTONE_API_TOKEN;

  const fields = [
    'お問合せ日',
    '新支店',
    '問合せ種別',
    '新ランク',
    '都道府県',
    'Main',
    '名簿取得者',
    'Customer',
  ];

  const EXCLUDE_KEYWORDS = ['デモ', '削除', 'テスト'];
  const QUERY_BASE = 'お問合せ日 >= "2022-08-01" order by お問合せ日 desc';
  const LIMIT = 500;

  const buildUrl = (offset) => {
    const params = new URLSearchParams();
    params.append('app', KINTONE_APP_ID);
    fields.forEach(f => params.append('fields[]', f));
    params.append('query', `${QUERY_BASE} limit ${LIMIT} offset ${offset}`);
    return `https://${KINTONE_SUBDOMAIN}.cybozu.com/k/v1/records.json?${params.toString()}`;
  };

  const fetchPage = async (offset) => {
    const response = await fetch(buildUrl(offset), {
      headers: { 'X-Cybozu-API-Token': KINTONE_API_TOKEN },
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`kintone API error: ${response.status} / ${errText}`);
    }
    const data = await response.json();
    return data.records;
  };

  const extractName = (field) => {
    if (!field || field.value === null || field.value === undefined) return '';
    const val = field.value;
    if (Array.isArray(val)) return val.map(u => u.name || u.code || '').filter(Boolean).join(', ');
    if (typeof val === 'object') return val.name || val.code || '';
    return String(val);
  };

  try {
    const firstPage = await fetchPage(0);
    let allRecords = [...firstPage];

    if (firstPage.length === LIMIT) {
      const PARALLEL = 10;
      let offset = LIMIT;
      let hasMore = true;

      while (hasMore) {
        const offsets = Array.from({ length: PARALLEL }, (_, i) => offset + i * LIMIT);
        const pages = await Promise.all(offsets.map(o => fetchPage(o)));
        for (const page of pages) {
          allRecords = allRecords.concat(page);
          if (page.length < LIMIT) { hasMore = false; break; }
        }
        offset += PARALLEL * LIMIT;
      }
    }

    const formatted = allRecords.map(r => {
      const dateRaw = r['お問合せ日']?.value || '';
      const ym = dateRaw ? dateRaw.slice(0, 7) : null;
      return {
        ym,
        branch:   r['新支店']?.value || '',
        type:     r['問合せ種別']?.value || '---',
        rank:     r['新ランク']?.value || '---',
        pref:     r['都道府県']?.value || '',
        tantou:   extractName(r['Main']),
        meibo:    extractName(r['名簿取得者']),
        customer: r['Customer']?.value || '',
      };
    }).filter(r => {
      if (!r.ym || r.ym < '2022-08') return false;
      if (r.branch === '商談外') return false;
      if (EXCLUDE_KEYWORDS.some(kw => r.customer.includes(kw))) return false;
      return true;
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ records: formatted, total: formatted.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
