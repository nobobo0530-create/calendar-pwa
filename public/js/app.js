'use strict';

const STORE = 'cal_';
const EVENTS_KEY = `${STORE}events`;

// カテゴリ定義 (色分け)
const CATS = {
  work:   { label: '仕事',     color: '#007AFF', bg: '#eff6ff' },
  life:   { label: 'プライベート', color: '#34C759', bg: '#f0fdf4' },
  nba:    { label: 'NBA',      color: '#AF52DE', bg: '#faf5ff' },
  other:  { label: 'その他',   color: '#FF9500', bg: '#fff7ed' },
};
const CAT_KEYS = ['work','life','nba','other'];

const S = {
  date: today(),
  selectedDate: today(),
  events: [],          // [{id, title, date, startTime, endTime, memo, cat, alarmBefore}]
  formData: null,      // フォーム表示中のイベント (新規 or 編集)
  alarmModal: null,    // {eventId} 通知発火中
  monthShift: 0,       // 月グリッドの月オフセット (0 = today's month)
  alarmTimers: [],
  audioCtx: null,
};

// ── 日付ユーティリティ ─────────────────────
function today() {
  const d = new Date();
  return ymd(d);
}
function p2(n) { return String(n).padStart(2,'0'); }
function ymd(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function fDate(ds) {
  const d = new Date(ds + 'T00:00:00');
  return `${d.getMonth()+1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
}
function toMin(t) { const [h,m]=(t||'00:00').split(':').map(Number); return h*60+m; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── ストレージ ─────────────────────────────
function loadEvents() {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); } catch(_) { return []; }
}
function saveEvents() {
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(S.events)); } catch(_) {}
}

// ── イベント生成 ───────────────────────────
function mkEvent(d) {
  return {
    id: d.id || uid(),
    title: d.title || '',
    date: d.date || today(),
    startTime: d.startTime || '09:00',
    endTime: d.endTime || '',
    memo: d.memo || '',
    cat: CATS[d.cat] ? d.cat : 'work',
    alarmBefore: typeof d.alarmBefore === 'number' ? d.alarmBefore : 5,
    alarmedPre: !!d.alarmedPre,
  };
}

// その日のイベント (時間順)
function eventsOn(date) {
  return S.events
    .filter(e => e.date === date)
    .sort((a,b) => toMin(a.startTime) - toMin(b.startTime));
}

// ── アラーム ───────────────────────────────
function playBeep(times) {
  try {
    if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = S.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    times = times || 2;
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t0 = ctx.currentTime + i * 0.4;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.4, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.4);
    }
  } catch(_) {}
}
function vibrateBuzz() { try { if (navigator.vibrate) navigator.vibrate([300,150,300]); } catch(_) {} }

function clearAlarms() {
  S.alarmTimers.forEach(h => clearTimeout(h));
  S.alarmTimers = [];
}
function scheduleAlarms() {
  clearAlarms();
  const t = today();
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
  S.events.forEach(ev => {
    if (ev.date !== t || ev.alarmedPre) return;
    const ab = typeof ev.alarmBefore === 'number' ? ev.alarmBefore : 5;
    if (ab <= 0) return;
    const fireMin = toMin(ev.startTime) - ab;
    if (fireMin <= nowMin) return;
    const ms = (fireMin - nowMin) * 60 * 1000;
    S.alarmTimers.push(setTimeout(() => firePre(ev.id), ms));
  });
}
function firePre(id) {
  const ev = S.events.find(x => x.id === id);
  if (!ev || ev.alarmedPre) return;
  ev.alarmedPre = true; saveEvents();
  playBeep(2); vibrateBuzz();
  // SW通知 (アプリ閉じてても表示)
  notifyEvent(ev);
  S.alarmModal = { eventId: id };
  render();
}
async function notifyEvent(ev) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const ab = ev.alarmBefore || 5;
  const title = `⏰ ${ab}分後に開始`;
  const body  = `${ev.startTime} ${ev.title}`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body, tag: 'event-' + ev.id,
        data: { url: '/' },
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
      return;
    }
  } catch(_) {}
  try { new Notification(title, { body }); } catch(_) {}
}
async function reqNotif() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') {
    try { await Notification.requestPermission(); } catch(_) {}
  }
}

// ── 描画: 選択日の予定セクション ────────────────
// 選択日 (S.selectedDate) のイベントを表示。今日なら「今日の予定」、別日なら「○月○日の予定」
function renderToday() {
  const isToday = S.selectedDate === today();
  const list = eventsOn(S.selectedDate);
  const label = isToday ? '今日の予定' : `${fDate(S.selectedDate).split('（')[0]}の予定`;
  const emptyMsg = isToday
    ? '今日の予定はありません<br>下の「+ 予定を追加」から登録'
    : 'この日の予定はありません<br>カレンダーから日を選び直すか「+ 予定を追加」から登録';
  const body = list.length === 0
    ? `<div class="empty">${emptyMsg}</div>`
    : `<div class="event-list">${list.map(renderEventCard).join('')}</div>`;
  return `<div class="section-title-row">
    <h3 class="section-title">📅 ${label} <span class="section-sub">${list.length}件</span></h3>
  </div>
  ${body}`;
}

function renderEventCard(ev) {
  const cat = CATS[ev.cat] || CATS.work;
  const time = ev.endTime ? `${ev.startTime}–${ev.endTime}` : ev.startTime;
  const meta = [
    `<span class="event-cat-tag" style="background:${cat.bg};color:${cat.color}">${cat.label}</span>`,
    ev.memo ? esc(ev.memo) : '',
  ].filter(Boolean).join(' ');
  return `<div class="event-card" style="border-left-color:${cat.color}" data-edit="${ev.id}">
    <div class="event-time">${time}</div>
    <div style="flex:1;min-width:0;">
      <div class="event-title">${esc(ev.title)}</div>
      <div class="event-meta">${meta}</div>
    </div>
  </div>`;
}

// ── 描画: 週間ストリップ ──────────────────
function renderWeek() {
  // 選択日(S.selectedDate)を含む週 (日曜起点)
  const cur = new Date(S.selectedDate + 'T00:00:00');
  const dow = cur.getDay(); // 0=日, 1=月, ..., 6=土
  const sunday = new Date(cur); sunday.setDate(cur.getDate() - dow);
  const todayStr = today();

  const eventDates = new Set(S.events.map(e => e.date));

  const days = Array.from({length:7}, (_, i) => {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    const ds = ymd(d);
    return {
      ds, num: d.getDate(), dow: '日月火水木金土'[i],
      isToday: ds === todayStr,
      isSelected: ds === S.selectedDate,
      hasEvents: eventDates.has(ds),
    };
  });

  return `<div class="section-title-row">
    <h3 class="section-title">📆 今週</h3>
  </div>
  <div class="week-strip">
    <div class="week-grid">
      ${days.map(d => `<button class="week-day${d.isSelected?' is-selected':''}${d.isToday?' is-today':''}" data-pick-day="${d.ds}">
        <div class="week-dow">${d.dow}</div>
        <div class="week-num">${d.num}</div>
        <div class="week-dot${d.hasEvents?' on':''}"></div>
      </button>`).join('')}
    </div>
  </div>`;
}

// ── 描画: 月グリッド ──────────────────
function renderMonth() {
  // monthShift で前後月へ
  const base = new Date(today()+'T00:00:00');
  base.setDate(1);
  base.setMonth(base.getMonth() + S.monthShift);
  const year = base.getFullYear();
  const month = base.getMonth();
  const monthLabel = `${year}年${month+1}月`;
  const todayStr = today();
  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=日曜起点
  const lastDay = new Date(year, month+1, 0).getDate();

  // 日付 → 当日のイベント配列マップ
  const byDate = {};
  S.events.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  Object.values(byDate).forEach(arr => arr.sort((a,b)=>toMin(a.startTime)-toMin(b.startTime)));

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startDow + 1;
    if (dayNum < 1 || dayNum > lastDay) cells.push({empty:true});
    else {
      const d = new Date(year, month, dayNum);
      const ds = ymd(d);
      cells.push({
        ds, num: dayNum, dow: d.getDay(),
        isToday: ds === todayStr,
        isSelected: ds === S.selectedDate,
        events: byDate[ds] || [],
      });
    }
  }

  return `<div class="section-title-row">
    <h3 class="section-title">🗓 月カレンダー</h3>
  </div>
  <div class="month-head">
    <button class="nav-btn" id="month-prev">‹</button>
    <div class="month-title">${monthLabel}</div>
    <button class="nav-btn" id="month-next">›</button>
  </div>
  <div class="month-grid-wrap">
    <div class="month-dow">
      <div>日</div><div>月</div><div>火</div><div>水</div><div>木</div><div>金</div><div>土</div>
    </div>
    <div class="month-grid">
      ${cells.map(c => {
        if (c.empty) return `<div class="month-cell empty"></div>`;
        const cls = ['month-cell'];
        if (c.isSelected) cls.push('is-selected');
        if (c.isToday)    cls.push('is-today');
        if (c.dow === 6)  cls.push('is-saturday');
        if (c.dow === 0)  cls.push('is-sunday');
        let evHtml = '';
        if (c.events.length === 1) {
          const cat = CATS[c.events[0].cat] || CATS.work;
          evHtml = `<div class="month-cell-event" style="background:${cat.bg};color:${cat.color}">${esc(c.events[0].title)}</div>`;
        } else if (c.events.length > 1) {
          const cat = CATS[c.events[0].cat] || CATS.work;
          evHtml = `<div class="month-cell-event" style="background:${cat.bg};color:${cat.color}">${esc(c.events[0].title)}</div>
                    <div class="month-cell-more">+${c.events.length - 1}</div>`;
        }
        return `<button class="${cls.join(' ')}" data-pick-day="${c.ds}">
          <div class="month-cell-num">${c.num}</div>
          ${evHtml}
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

// ── 描画: 追加/編集フォーム ─────────────
function renderForm() {
  const d = S.formData || {};
  const isEdit = !!d.id;
  const cat = CATS[d.cat] ? d.cat : 'work';
  const alarmCur = typeof d.alarmBefore === 'number' ? d.alarmBefore : 5;
  const alarmOpts = [0, 5, 10, 15, 30, 60];

  return `<div class="modal" id="form-modal">
    <div class="modal-card">
      <div class="modal-head">
        <button class="modal-back" id="form-cancel">キャンセル</button>
        <h2>${isEdit?'予定を編集':'予定を追加'}</h2>
        ${isEdit?`<button class="modal-del" id="form-del" title="削除">🗑</button>`:'<div style="width:28px"></div>'}
      </div>
      <div class="field">
        <label>タイトル</label>
        <input class="input" id="f-title" value="${esc(d.title||'')}" placeholder="例: ヨガ / レイカーズ vs..." maxlength="80">
      </div>
      <div class="field">
        <label>カテゴリ</label>
        <div class="cat-chips">
          ${CAT_KEYS.map(k => `<button class="cat-chip${cat===k?' on':''}" data-cat="${k}" style="--cat-color:${CATS[k].color};--cat-bg:${CATS[k].bg};">${CATS[k].label}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>日付</label>
        <input class="input" id="f-date" type="date" value="${esc(d.date||S.selectedDate)}">
      </div>
      <div class="row-2">
        <div class="field">
          <label>開始時刻</label>
          <input class="input" id="f-start" type="time" value="${esc(d.startTime||'09:00')}">
        </div>
        <div class="field">
          <label>終了時刻 (任意)</label>
          <input class="input" id="f-end" type="time" value="${esc(d.endTime||'')}">
        </div>
      </div>
      <div class="field">
        <label>アラーム (開始の◯分前)</label>
        <div class="alarm-chips">
          ${alarmOpts.map(n => `<button class="alarm-chip${alarmCur===n?' on':''}" data-alarm="${n}">${n===0?'なし':`${n}分前`}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>メモ (任意)</label>
        <textarea class="input" id="f-memo" placeholder="メモ・場所など" maxlength="200">${esc(d.memo||'')}</textarea>
      </div>
      <button class="save-btn" id="form-save">${isEdit?'保存する':'追加する'}</button>
    </div>
  </div>`;
}

// ── 描画: アラームモーダル ─────────────
function renderAlarmModal() {
  if (!S.alarmModal) return '';
  const ev = S.events.find(x => x.id === S.alarmModal.eventId);
  if (!ev) return '';
  const ab = ev.alarmBefore || 5;
  const cat = CATS[ev.cat] || CATS.work;
  return `<div class="modal" style="z-index:10000">
    <div class="alarm-modal">
      <div class="alarm-head" style="background:${cat.color}">
        <div class="icon">⏰</div>
        <div class="text">${ab}分後に開始</div>
      </div>
      <div class="alarm-body">
        <div class="title">${esc(ev.title)}</div>
        <div class="time">${ev.startTime}${ev.endTime?'〜'+ev.endTime:''} ・ ${cat.label}</div>
        ${ev.memo?`<div class="time" style="margin-top:8px">${esc(ev.memo)}</div>`:''}
      </div>
      <div class="alarm-btns">
        <button class="alarm-btn alarm-skip" id="alarm-close">閉じる</button>
        <button class="alarm-btn alarm-ok" id="alarm-ok" style="background:${cat.color}">OK</button>
      </div>
    </div>
  </div>`;
}

// ── メイン描画 ────────────────────────
function render() {
  const t = today();
  const isSelToday = S.selectedDate === t;
  const cur = new Date(t + 'T00:00:00');
  const monthLabel = `${cur.getFullYear()}年${cur.getMonth()+1}月`;

  document.getElementById('app').innerHTML = `
    <div class="header">
      <div>
        <div class="header-eyebrow">${isSelToday?'TODAY · 今日':'SELECTED'}</div>
        <div class="header-date">${fDate(S.selectedDate)}</div>
      </div>
      ${!isSelToday?`<button class="nav-btn" id="goto-today" style="width:auto;padding:0 12px;font-size:12px;font-weight:700;background:var(--card);border:1px solid var(--border);color:var(--text);">今日</button>`:''}
    </div>
    ${renderToday()}
    ${renderWeek()}
    ${renderMonth()}
    <div class="bottom-bar">
      <button class="bar-btn" id="btn-add">＋ 予定を追加</button>
      <button class="bar-btn" id="btn-export" style="background:#f3f4f6;color:#374151;font-size:13px;margin-top:8px;">📤 データを新しいアプリに移す</button>
      <button class="bar-btn" id="btn-import" style="background:#f3f4f6;color:#374151;font-size:13px;margin-top:4px;">📥 データを貼り付けて復元</button>
    </div>
    ${S.formData ? renderForm() : ''}
    ${renderAlarmModal()}
  `;
  bind();
}

// ── イベント登録 ─────────────────────
function bind() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  const all = (sel, fn) => document.querySelectorAll(sel).forEach(fn);

  // アラームモーダル優先
  if (S.alarmModal) {
    on('alarm-ok',    () => { S.alarmModal = null; render(); });
    on('alarm-close', () => { S.alarmModal = null; render(); });
    return;
  }

  // フォームモーダル
  if (S.formData) {
    on('form-cancel', () => { S.formData = null; render(); });
    on('form-del', () => {
      if (!confirm('この予定を削除しますか?')) return;
      S.events = S.events.filter(e => e.id !== S.formData.id);
      saveEvents(); scheduleAlarms();
      S.formData = null; render();
    });
    on('form-save', saveForm);
    all('.cat-chip', c => c.addEventListener('click', e => {
      all('.cat-chip', x => x.classList.remove('on'));
      e.currentTarget.classList.add('on');
    }));
    all('.alarm-chip', c => c.addEventListener('click', e => {
      all('.alarm-chip', x => x.classList.remove('on'));
      e.currentTarget.classList.add('on');
    }));
    return;
  }

  // 通常画面
  on('btn-export', () => {
    const data = localStorage.getItem(EVENTS_KEY) || '[]';
    prompt('このテキストを全選択してコピー → 新しいアプリの「データを貼り付けて復元」ボタンに貼り付けてください', data);
  });
  on('btn-import', () => {
    const text = prompt('エクスポートしたテキストを貼り付けてください');
    if (!text) return;
    try {
      let json = text.trim();
      // URL形式（?import=xxx）の場合はbase64部分を取り出す
      if (json.includes('?import=')) {
        const b64 = json.split('?import=')[1].split('&')[0];
        try { json = decodeURIComponent(escape(atob(b64))); } catch(_) {
          try { json = decodeURIComponent(atob(b64)); } catch(__) {}
        }
      }
      const list = JSON.parse(json);
      if (!Array.isArray(list)) { alert('データの形式が正しくありません'); return; }
      if (list.length === 0) { alert('データが空です'); return; }
      if (confirm(`${list.length}件の予定を追加しますか？`)) {
        list.forEach(d => S.events.push(mkEvent(d)));
        saveEvents();
        scheduleAlarms();
        if (list[0]?.date) S.selectedDate = list[0].date;
        alert(`✅ ${list.length}件を復元しました`);
        render();
      }
    } catch(e) { alert('貼り付けたデータを読み込めませんでした: ' + e.message); }
  });
  on('btn-add', () => {
    S.formData = { date: S.selectedDate, startTime: nextRoundTime(), cat: 'work' };
    render();
  });
  on('goto-today', () => { S.selectedDate = today(); S.monthShift = 0; render(); });
  on('month-prev', () => { S.monthShift--; render(); });
  on('month-next', () => { S.monthShift++; render(); });
  all('[data-pick-day]', btn => btn.addEventListener('click', e => {
    S.selectedDate = e.currentTarget.dataset.pickDay;
    render();
  }));
  all('[data-edit]', btn => btn.addEventListener('click', e => {
    const ev = S.events.find(x => x.id === e.currentTarget.dataset.edit);
    if (ev) { S.formData = { ...ev }; render(); }
  }));
}

function nextRoundTime() {
  const d = new Date();
  const m = Math.ceil((d.getHours()*60 + d.getMinutes() + 10) / 10) * 10;
  return `${p2(Math.floor(m/60)%24)}:${p2(m%60)}`;
}

function saveForm() {
  const title = document.getElementById('f-title')?.value.trim();
  if (!title) { alert('タイトルを入力してください'); return; }
  const date = document.getElementById('f-date')?.value;
  if (!date) { alert('日付を選んでください'); return; }
  const startTime = document.getElementById('f-start')?.value || '09:00';
  const endTime = document.getElementById('f-end')?.value || '';
  if (endTime && toMin(endTime) <= toMin(startTime)) {
    alert('終了時刻は開始時刻より後にしてください'); return;
  }
  const memo = document.getElementById('f-memo')?.value.trim() || '';
  const catEl = document.querySelector('.cat-chip.on');
  const cat = catEl?.dataset.cat || 'work';
  const alarmEl = document.querySelector('.alarm-chip.on');
  const alarmBefore = alarmEl ? Number(alarmEl.dataset.alarm) : 5;

  if (S.formData?.id) {
    const i = S.events.findIndex(e => e.id === S.formData.id);
    if (i >= 0) {
      const wasStart = S.events[i].startTime;
      S.events[i] = { ...S.events[i], title, date, startTime, endTime, memo, cat, alarmBefore,
        alarmedPre: wasStart === startTime ? S.events[i].alarmedPre : false };
    }
  } else {
    S.events.push(mkEvent({ title, date, startTime, endTime, memo, cat, alarmBefore }));
  }
  saveEvents();
  scheduleAlarms();
  // 追加した日付を表示
  S.selectedDate = date;
  S.formData = null;
  render();
}

// ── URL パラメータからイベントをインポート ──
// 使い方: ?import=<base64(JSON配列)> でアクセスすると確認後に追加
function tryImportFromUrl() {
  try {
    const url = new URL(window.location.href);
    const imp = url.searchParams.get('import');
    if (!imp) return;
    // Unicode-safe base64 decode
    const json = decodeURIComponent(escape(atob(imp)));
    const list = JSON.parse(json);
    if (!Array.isArray(list) || list.length === 0) return;
    const summary = list.map(d => `・${d.date} ${d.startTime||''} ${d.title}`).join('\n');
    if (confirm(`${list.length}件の予定を追加しますか?\n\n${summary}`)) {
      list.forEach(d => S.events.push(mkEvent(d)));
      saveEvents();
      scheduleAlarms();
      // 一番先頭の日付に自動移動
      if (list[0]?.date) S.selectedDate = list[0].date;
      alert(`✅ ${list.length}件の予定を追加しました`);
    }
    // URLパラメータを除去 (リロードで再実行されないため)
    url.searchParams.delete('import');
    history.replaceState(null, '', url.pathname + url.search);
  } catch(e) {
    console.warn('[import] error:', e);
  }
}

// ── 起動 ───────────────────────────────
async function init() {
  S.events = loadEvents();
  tryImportFromUrl();   // ★ URL ?import=... があれば取り込む
  reqNotif();
  scheduleAlarms();
  // 1分ごとの保険チェック (バックグラウンド復帰対策)
  setInterval(() => {
    const t = today();
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    S.events.forEach(ev => {
      if (ev.date !== t || ev.alarmedPre) return;
      const ab = typeof ev.alarmBefore === 'number' ? ev.alarmBefore : 5;
      if (ab <= 0) return;
      const fireMin = toMin(ev.startTime) - ab;
      if (nowMin >= fireMin && nowMin < fireMin + 1) firePre(ev.id);
    });
  }, 30000);
  // タップで AudioContext 解錠 (iOS)
  document.addEventListener('click', () => {
    if (!S.audioCtx) { try { S.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(_){} }
    if (S.audioCtx?.state === 'suspended') S.audioCtx.resume();
  }, { once: true });
  // 復帰時にもアラーム再スケジュール
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleAlarms();
  });
  // SW 登録 + 自動更新
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.update().catch(()=>{});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(()=>{});
      });
    }).catch(()=>{});
  }
  render();
}
init();
