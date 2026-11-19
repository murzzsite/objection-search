/* Поиск ответа по тексту клиента: нормализация, приставочные основы, понятия-синонимы, tf-idf + точные фразы. */
(function (root) {
  const STOP = new Set('и в во на я мне меня мы вы вас вам нам что это как а но или то же бы ли для по из от до при со к у о об так вот его ее её их он она они тут там да ну уже еще ещё мой моя мои ваш ваша вами нас всё все был была были было буду будет будут есть нужно надо можно просто очень пожалуйста здравствуйте добрый день привет спасибо вообще тоже этот эта эти этого такой такая'.split(' '));

  const CONCEPTS = {
    REFUND: ['верни','вернит','вернут','вернуть','верну','возврат','возвращ','возмещ','компенс','деньги назад','отдайте деньги','отдай деньги','назад деньги','заберите деньги','вернёте','вернете'],
    LEAVE: ['расторг','расторж','отказ','отмен','закончим','прекрат','разорв','не хочу продолж','выйти из договор','завершить сотрудн','хватит','не буду продолж','не хочу сотрудн'],
    NORESULT: ['нет результат','результата нет','результата не','не было результат','без результат','нет эффект','нет толк','нет заявок','заявок нет','нет лидов','лидов нет','ни одной заявк','ни одного лид','ни одного клиент','нет клиентов','клиентов нет','не приходят','не вижу','ничего не получ','не получил','не дали результат','ничего не дало','никакого результат','никакого эффект','нет отдачи','нет обращен','обращений нет'],
    LEADS: ['заяв','лид','клиент','обращен','звонк'],
    PROMISE: ['обещ','говорил','сказал','уверял','гарантир','рассказыв','продажник','менеджер говорил','созвон','заверял'],
    PERCENT: ['процент','%','комисси'],
    MONEY: ['деньг','оплат','платит','платеж','плачу','заплат','стоим','цена','цену','бюдж','руб','₽','тыс','7500','20000','средств','пополн','баланс'],
    EXTRAPAY: ['допл','допрасход','доп расход','дополнительн','сверх','ещё платить','еще платить','вперед','вперёд','предоплат','пополн','баланс','скрытые'],
    ANGRY: ['развод','обман','мошенн','кинул','лохотр','ужас','безобраз','хамств','наглост','издева','позор','беспредел','жулик','аферист'],
    IGNORE: ['игнор','молч','тишин','не отвеча','ответьте','пропал','нет ответа','жду ответа','не пишет','не отвечает'],
    ACT: ['акт','подпис','закрывающ'],
    DOMAIN: ['домен','reg.ru','регистратор','госуслуг','перенос','dns'],
    SEO: ['сео','seo','поиск','яндекс','гугл','google','позици','продвиж','выдач'],
    SITE: ['сайт','страниц','лендинг','тильд'],
    GUIDE: ['гайд','лид-магнит','pdf','пдф','трипвайер','tripwire'],
    BOT: ['бот','геймиф','квест'],
    LEGAL: ['суд','иск','претенз','прокуратур','роспотреб','юрист','адвокат','полици'],
    TIME: ['срок','долго','давно','задерж','затян','сколько ждать','когда будет','когда пришл','когда сдад'],
    EXPENSIVE: ['дорого','дорог','нет денег','не потяну','нет бюджета','скидк','рассрочк','частями','подорожал','накладно','не хватает денег'],
    CALL: ['позвон','созвон','телефон','голосом','живой человек','наберите','перезвон'],
    THINK: ['подума','посоветуюсь','позже','не сейчас','отвечу позже'],
    CANT: ['не могу','не получается','не работает','ошибка','не открывается','не заходит','не понимаю','непонятно'],
    EDITS: ['правк','поправ','исправ','изменить','переделать','переделайте'],
    DOCS: ['договор','чек','счёт','счет','реквизит','инн','эдо','диадок']
  };
  const CONCEPT_LIST = Object.entries(CONCEPTS);

  function norm(s) {
    s = String(s || '').toLowerCase().replace(/ё/g, 'е');
    s = s.replace(/(\d)[\s ](?=\d{3}(?!\d))/g, '$1');
    s = s.replace(/двадцат[ьи]\s+тысяч\w*/g, '20000').replace(/сем[ьи]\s+с\s+половиной\s+тысяч\w*/g, '7500').replace(/семь\s+тысяч\s+пятьсот/g, '7500').replace(/двадцатк\w*/g, '20000');
    return s;
  }
  function tokens(s) { return norm(s).match(/[\p{L}\p{N}%₽.@_-]+/gu)?.map(t => t.replace(/^[.\-_]+|[.\-_]+$/g, '')).filter(Boolean) || []; }
  function stemHit(token, stem) {
    if (stem.length <= 3) return token === stem || (token.startsWith(stem) && token.length <= stem.length + 2);
    return token.startsWith(stem);
  }
  function phraseHit(toks, phrase) {
    const ps = tokens(phrase);
    if (!ps.length) return false;
    if (ps.length === 1) return toks.some(t => stemHit(t, ps[0]));
    for (let i = 0; i < toks.length; i++) {
      if (!stemHit(toks[i], ps[0])) continue;
      let j = i, ok = true;
      for (let k = 1; k < ps.length; k++) {
        j++;
        if (j < toks.length && stemHit(toks[j], ps[k])) continue;
        if (j + 1 < toks.length && stemHit(toks[j + 1], ps[k])) { j++; continue; }
        ok = false; break;
      }
      if (ok) return true;
    }
    return false;
  }
  // нормализуем нормы паттернов один раз
  const CP = CONCEPT_LIST.map(([n, ps]) => [n, ps.map(p => tokens(p))]);
  function conceptsOf(toks) {
    const out = [];
    for (const [name, pats] of CONCEPT_LIST) {
      for (const p of pats) { if (phraseHit(toks, p)) { out.push(name); break; } }
    }
    return out;
  }
  function stemOf(t) { return t.length > 4 ? t.slice(0, 4) : t; }
  function features(text) {
    const toks = tokens(text);
    const f = new Map();
    const add = (k, w) => f.set(k, (f.get(k) || 0) + w);
    const stems = [];
    for (const t of toks) {
      if (STOP.has(t) || t.length < 2) continue;
      const s = stemOf(t); stems.push(s); add('s:' + s, 1);
    }
    for (let i = 0; i < stems.length - 1; i++) add('b:' + stems[i] + '_' + stems[i + 1], 1.2);
    for (const c of conceptsOf(toks)) add('c:' + c, 2.5);
    return f;
  }

  let INDEX = null;
  function build(DB) {
    const N = DB.length, df = new Map(), vecs = [];
    for (const e of DB) {
      const sig = [e.title, (e.kw || []).join('. '), (e.ex || []).join('. ')].join('. ');
      const f = features(sig); vecs.push(f);
      for (const k of f.keys()) df.set(k, (df.get(k) || 0) + 1);
    }
    const idf = k => Math.log(1 + N / (df.get(k) || 1));
    const vec = DB.map((e, i) => {
      const f = vecs[i], v = new Map(); let n = 0;
      for (const [k, tf] of f) { const w = (1 + Math.log(tf)) * idf(k); v.set(k, w); n += w * w; }
      return { v, n: Math.sqrt(n) };
    });
    INDEX = { DB, idf, vec };
  }
  function search(text) {
    if (!INDEX) return [];
    const toks = tokens(text);
    if (toks.filter(t => !STOP.has(t)).length < 1 || norm(text).trim().length < 4) return [];
    const q = features(text), qv = new Map(); let qn = 0;
    for (const [k, tf] of q) { const w = (1 + Math.log(tf)) * INDEX.idf(k); qv.set(k, w); qn += w * w; }
    qn = Math.sqrt(qn) || 1;
    const out = [];
    INDEX.DB.forEach((e, i) => {
      const ev = INDEX.vec[i]; let dot = 0; const shared = [];
      for (const [k, w] of qv) { const x = ev.v.get(k); if (x) { dot += w * x; if (k[0] === 's') shared.push(k.slice(2)); } }
      const cos = dot / (qn * (ev.n || 1));
      let kws = 0; const hits = [];
      for (const k of (e.kw || [])) {
        if (phraseHit(toks, k)) {
          const wc = tokens(k).length;
          kws += wc >= 2 ? 4 : (/^\d/.test(k) ? 3.6 : (k.length <= 3 ? 1.5 : 2.2));
          hits.push(k);
        }
      }
      for (const k of (e.ex || [])) {
        if (phraseHit(toks, k)) {
          const wc = tokens(k).filter(t => !STOP.has(t)).length;
          kws += wc >= 2 ? 3.5 : 2;
          hits.push(k);
        }
      }
      kws = Math.min(kws, 18);
      const score = cos * 30 + kws;
      if (score >= 3 && (hits.length || cos >= 0.16)) out.push({ e, score, cos, hits, shared });
    });
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  function emotion(text) {
    let s = 0; const n = norm(text);
    const hotW = ['мошенн','развод','обман','суд','иск','претенз','верните','верни','игнор','безобраз','ужас','хамств','позор','беспредел','кинул','лохотрон','сколько можно','издева','наглост'];
    for (const w of hotW) if (n.includes(w)) s += 2;
    const letters = text.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 15) { const up = letters.replace(/[^\p{Lu}]/gu, '').length; if (up / letters.length > 0.4) s += 3; }
    s += Math.min(3, (text.match(/!/g) || []).length);
    return s;
  }
  root.ENGINE = { norm, tokens, stemHit, phraseHit, conceptsOf, features, build, search, emotion, STOP, CONCEPTS };
  if (typeof module !== 'undefined') module.exports = root.ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
