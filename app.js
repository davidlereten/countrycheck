const SUPABASE_URL_FALLBACK = "https://ftrxlqdjmtspvwupoiyq.supabase.co";
const SUPABASE_KEY_FALLBACK = "sb_publishable_ZJ0UnfPazyYwwOIYSzKw6Q_47n9n5E6";

function normalizeSupabaseUrl(value){
  let v = String(value || SUPABASE_URL_FALLBACK).trim();
  v = v.replace(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*/i, '').trim();
  v = v.replace(/^['\"]|['\"]$/g, '').trim();
  v = v.replace(/\/rest\/v1\/?$/i, '').trim();
  if(!/^https?:\/\//i.test(v)) v = SUPABASE_URL_FALLBACK;
  return v;
}

function normalizeSupabaseKey(value){
  let v = String(value || SUPABASE_KEY_FALLBACK).trim();
  v = v.replace(/^NEXT_PUBLIC_SUPABASE_(PUBLISHABLE|ANON)_KEY\s*=\s*/i, '').trim();
  v = v.replace(/^['\"]|['\"]$/g, '').trim();
  return v || SUPABASE_KEY_FALLBACK;
}

const URL = "https://ftrxlqdjmtspvwupoiyq.supabase.co";
const KEY = "sb_publishable_ZJ0UnfPazyYwwOIYSzKw6Q_47n9n5E6";
let sb = null;
let currentUser = null;
let lastLoginPassword = '';
let db = {
  countries: [],
  poiDocs: [],
  porDocs: [],
  docDescriptions: {},
  rules: {
    directBlocked: [],
    platformWarnings: {},
    poiPorRequired: [],
    porRequired: [],
    gcc: []
  },
  lastUpdated: ''
};

function qs(id){ return document.getElementById(id); }
function show(id){ qs(id).classList.remove('hidden'); }
function hide(id){ qs(id).classList.add('hidden'); }
function cleanUsername(v){ return String(v || '').trim().toLowerCase().replace(/\s+/g,''); }
function usernameToEmail(username){ return `${cleanUsername(username)}@countrycheck.local`; }
function defaultPasswordFor(username){
  const parts = cleanUsername(username).split('.');
  const first = (parts[0] || '').charAt(0).toUpperCase();
  const last = (parts[1] || '').charAt(0).toLowerCase();
  if(!first || !last) return '';
  return `${first}${last}123${first}${last}123!!`;
}
function strongPassword(p){ return p.length >= 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p); }
function page(pageName){
  ['loginPage','passwordPage','appPage'].forEach(hide);
  show(pageName);
}
function safeText(s){ return String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

function setupPasswordEye(){
  const btn = qs('toggleLoginPassword');
  const input = qs('loginPassword');
  if(!btn || !input) return;
  btn.addEventListener('click', ()=>{
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
  });
}


function setMessage(id, text){
  const el = qs(id);
  if(el) el.textContent = text || '';
}
function setLoginBusy(isBusy){
  const btn = document.querySelector('#loginForm button[type="submit"]');
  if(btn){
    btn.disabled = !!isBusy;
    btn.textContent = isBusy ? 'Checking...' : 'Login';
  }
}
function withTimeout(promise, ms, label='Request'){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out. Check internet connection, Supabase URL/key, and browser console.`)), ms))
  ]);
}
function ensureSupabase(){
  if(!URL || !KEY || URL.includes('PASTE_') || KEY.includes('PASTE_')){
    setMessage('loginMessage', 'Supabase config is missing. Paste Project URL and Publishable/anon key into supabase-config.js.');
    return false;
  }
  if(!window.supabase || typeof window.supabase.createClient !== 'function'){
    setMessage('loginMessage', 'Supabase library could not load. Check internet connection or CDN blocking.');
    return false;
  }
  try {
    if(!sb) sb = window.supabase.createClient(URL, KEY);
    return true;
  } catch (err) {
    setMessage('loginMessage', 'Supabase client could not start: ' + (err?.message || err));
    return false;
  }
}

async function init(){
  if(!ensureSupabase()) return;
  try {
    const { data, error } = await withTimeout(sb.auth.getSession(), 10000, 'Session check');
    if(error) console.warn('Session check error:', error);
    if(data?.session){
      currentUser = data.session.user;
      page('appPage');
      await loadDatabase();
      bootApp();
    } else {
      page('loginPage');
    }
  } catch (err) {
    console.error('CountryCheck init error:', err);
    setMessage('loginMessage', 'Startup error: ' + (err?.message || err));
    page('loginPage');
  }
}

qs('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!ensureSupabase()) return;

  const username = cleanUsername(qs('loginName').value);
  const password = qs('loginPassword').value;
  lastLoginPassword = password;
  setMessage('loginMessage', '');

  if(!/^[a-z]+\.[a-z]$/.test(username)){
    setMessage('loginMessage', 'Username format should be like paul.a');
    return;
  }

  setLoginBusy(true);
  try {
    const email = usernameToEmail(username);
    const { data, error } = await withTimeout(
      sb.auth.signInWithPassword({ email, password }),
      15000,
      'Login'
    );

    if(error){
      const msg = error.message || 'Login failed.';
      if(msg.toLowerCase().includes('invalid')) setMessage('loginMessage', 'Login failed: username or password is incorrect.');
      else if(msg.toLowerCase().includes('confirm')) setMessage('loginMessage', 'Login failed: user email is not confirmed in Supabase. Open Authentication → Users and confirm this user.');
      else setMessage('loginMessage', 'Login failed: ' + msg);
      return;
    }

    if(!data || !data.user){
      setMessage('loginMessage', 'Login failed: Supabase returned no user. Check Authentication → Users.');
      return;
    }

    currentUser = data.user;
    page('appPage');
    await loadDatabase();
    bootApp();
  } catch (err) {
    setMessage('loginMessage', 'Login error: ' + (err?.message || err));
    console.error('CountryCheck login error:', err);
  } finally {
    setLoginBusy(false);
  }
});

qs('passwordForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const pass = qs('newPassword').value;
  const pass2 = qs('confirmPassword').value;
  qs('passwordMessage').textContent = '';
  if(pass !== pass2){ qs('passwordMessage').textContent = 'Passwords do not match.'; return; }
  if(!strongPassword(pass)){ qs('passwordMessage').textContent = 'Use at least 12 characters with uppercase, lowercase, number and symbol.'; return; }
  if(pass === lastLoginPassword){ qs('passwordMessage').textContent = 'New password cannot be the initial password.'; return; }
  try {
    const { error } = await withTimeout(sb.auth.updateUser({ password: pass }), 15000, 'Password update');
    if(error){ qs('passwordMessage').textContent = 'Password update failed: ' + (error.message || 'Try again.'); return; }
    page('appPage');
    await loadDatabase();
    bootApp();
  } catch (err) {
    qs('passwordMessage').textContent = 'Password update error: ' + (err?.message || err);
  }
});

qs('logoutBtn').addEventListener('click', async ()=>{
  if(sb) await sb.auth.signOut();
  currentUser = null;
  page('loginPage');
});

async function loadDatabase(){
  render('review','Loading Rules','Please wait while CountryCheck loads the rule database.');
  const [countriesRes, docsRes, settingsRes, listsRes, warningsRes] = await Promise.all([
    sb.from('countries').select('code,name').order('name'),
    sb.from('documents').select('doc_type,name,description,sort_order').eq('active', true).order('sort_order'),
    sb.from('app_settings').select('key,value'),
    sb.from('country_rule_lists').select('list_type,country_code'),
    sb.from('platform_warnings').select('country_code,message')
  ]);
  const err = [countriesRes, docsRes, settingsRes, listsRes, warningsRes].find(r => r.error)?.error;
  if(err){ render('rejected','Database Error','Could not load CountryCheck data. Check Supabase RLS and setup SQL.'); return; }
  db.countries = countriesRes.data || [];
  const docs = docsRes.data || [];
  db.poiDocs = docs.filter(d => d.doc_type === 'POI').map(d => d.name);
  db.porDocs = docs.filter(d => d.doc_type === 'POR').map(d => d.name);
  db.docDescriptions = Object.fromEntries(docs.map(d => [d.name, d.description || 'Accepted document type.']));
  const settings = Object.fromEntries((settingsRes.data || []).map(s => [s.key, s.value]));
  db.lastUpdated = settings.last_updated?.label || settings.last_updated || '';
  db.rules = { directBlocked: [], poiPorRequired: [], porRequired: [], gcc: [], platformWarnings: {} };
  (listsRes.data || []).forEach(r => {
    if(r.list_type === 'direct_block') db.rules.directBlocked.push(r.country_code);
    if(r.list_type === 'poi_por_required') db.rules.poiPorRequired.push(r.country_code);
    if(r.list_type === 'por_required') db.rules.porRequired.push(r.country_code);
    if(r.list_type === 'gcc') db.rules.gcc.push(r.country_code);
  });
  (warningsRes.data || []).forEach(w => db.rules.platformWarnings[w.country_code] = w.message);
}

function flagIcon(code, alt='') {
  if (!code) return '<span class="flag-fallback">?</span>';
  if (code === 'BALKANS') return '<span class="flag-fallback">🌍</span>';
  if (code.length !== 2) return '<span class="flag-fallback">•</span>';
  const lower = code.toLowerCase();
  return `<img class="flag-img" alt="${safeText(alt || code)} flag" src="https://flagcdn.com/w40/${lower}.png" srcset="https://flagcdn.com/w80/${lower}.png 2x" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'flag-fallback',textContent:'${code}'}))">`;
}
function plainNameOf(code) { return (db.countries.find(c => c.code === code) || {name: code}).name; }
function countryLine(code) { return `<span class="country-line">${flagIcon(code, plainNameOf(code))}<span>${safeText(plainNameOf(code))}</span></span>`; }
function makeCountryPicker(hiddenId, pickerId, defaultCode) {
  const hidden = qs(hiddenId); const picker = qs(pickerId);
  let selected = defaultCode || '';
  hidden.value = selected;
  const selectedCountry = () => db.countries.find(c => c.code === selected);
  const renderButton = () => {
    const c = selectedCountry();
    return `<button type="button" class="country-btn" aria-haspopup="listbox"><span class="country-selected">${c ? flagIcon(c.code, c.name) : '<span class="flag-fallback">?</span>'}<span>${c ? safeText(c.name) : 'Select country'}</span></span><span class="chev">▾</span></button>`;
  };
  const renderOptions = (query='') => {
    const q = query.trim().toLowerCase();
    const rows = db.countries.filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)).map(c => `<button type="button" class="country-option ${c.code === selected ? 'active' : ''}" data-code="${c.code}" role="option">${flagIcon(c.code, c.name)}<span>${safeText(c.name)}</span></button>`).join('');
    return rows || '<div class="mini" style="padding:12px">No country found.</div>';
  };
  const draw = (query='') => { picker.innerHTML = renderButton() + `<div class="country-menu"><input class="country-search" placeholder="Search country..." value="${safeText(query)}"><div class="country-options">${renderOptions(query)}</div></div>`; };
  draw();
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.country-btn'); const opt = e.target.closest('.country-option');
    if (btn) { picker.classList.toggle('open'); const search = picker.querySelector('.country-search'); setTimeout(() => search && search.focus(), 20); }
    if (opt) { selected = opt.dataset.code; hidden.value = selected; picker.classList.remove('open'); draw(); check(); }
  });
  picker.addEventListener('input', (e) => { if (e.target.classList.contains('country-search')) picker.querySelector('.country-options').innerHTML = renderOptions(e.target.value); });
  document.addEventListener('click', (e) => { if (!picker.contains(e.target)) picker.classList.remove('open'); });
}
function escapeAttr(str) { return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function docPill(d) { return `<span class="pill doc-tip" tabindex="0" data-tip="${escapeAttr(db.docDescriptions[d] || 'Accepted document type.')}" >${safeText(d)}</span>`; }
function fillCountries() {
  makeCountryPicker('regCountry', 'regCountryPicker', 'BS');
  makeCountryPicker('nationality', 'nationalityPicker', 'FR');
}
function fillDocs() {
  qs('poiDoc').innerHTML = '<option value="">No POI provided</option>' + db.poiDocs.map(d => `<option>${safeText(d)}</option>`).join('');
  qs('porDoc').innerHTML = '<option value="">No POR provided</option>' + db.porDocs.map(d => `<option>${safeText(d)}</option>`).join('');
  qs('poiPills').innerHTML = db.poiDocs.map(docPill).join('');
  qs('porPills').innerHTML = db.porDocs.map(docPill).join('');
}
function inList(code, list) { return list.includes(code); }
function block(title, items) { if (!items || !items.length) return ''; return `<div class="block"><div class="block-title">${safeText(title)}</div><ul class="list">${items.map(i => `<li>${safeText(i)}</li>`).join('')}</ul></div>`; }
function ruleBlock(title, rows) { if (!rows || !rows.length) return ''; return `<div class="block"><div class="block-title">${safeText(title)}</div><div class="rule-card">${rows.map(r => `<div class="rule-row"><div class="rule-key">${safeText(r.label)}</div><div class="rule-value">${r.value}</div></div>`).join('')}</div></div>`; }
function render(cls, title, reason, blocks=[]) {
  const el = qs('result');
  el.className = 'result ' + cls;
  el.innerHTML = `<div class="status"><span class="dot"></span><strong>${safeText(title)}</strong></div><div class="reason">${safeText(reason)}</div>${blocks.join('')}`;
}

function evaluate(){
  const reg = qs('regCountry').value; const nat = qs('nationality').value; const poi = qs('poiDoc').value; const por = qs('porDoc').value;
  if (!reg || !nat) return {cls:'review', title:'Missing Selection', reason:'Please select both registration country and nationality.', blocks:[], warnings:[]};
  const regPlain = plainNameOf(reg); const natPlain = plainNameOf(nat); const warnings = [];
  if (db.rules.platformWarnings[reg]) warnings.push(`Registration Country: ${regPlain} — ${db.rules.platformWarnings[reg]}.`);
  if (db.rules.platformWarnings[nat]) warnings.push(`Nationality: ${natPlain} — ${db.rules.platformWarnings[nat]}.`);
  if (db.rules.gcc.includes(reg)) warnings.push('GCC / Dubai office note may apply. Mirrox/Savexa resident restrictions should be checked internally.');
  if (reg === 'AE' || nat === 'AE') warnings.push('United Arab Emirates citizen case: ask Dubai office to confirm.');

  let out;
  if (inList(reg, db.rules.directBlocked)) {
    out = {cls:'rejected', title:'Not Eligible', reason:`Registration country ${regPlain} is restricted.`, blocks:[
      ruleBlock('Registration Country', [{label:'Country', value:countryLine(reg)}, {label:'Rule', value:'Restricted even with alternative POI/POR'}, {label:'Note', value:'Double citizenship does not matter'}]), block('Warnings', warnings)
    ], warnings};
  } else if (inList(nat, db.rules.directBlocked)) {
    out = {cls:'rejected', title:'Not Eligible', reason:`Nationality ${natPlain} is restricted for onboarding.`, blocks:[
      ruleBlock('Nationality', [{label:'Country', value:countryLine(nat)}, {label:'Rule', value:'Restricted even with alternative POI/POR'}, {label:'Note', value:'Double citizenship does not matter'}]), block('Warnings', warnings)
    ], warnings};
  } else if (inList(nat, db.rules.poiPorRequired)) {
    const missing=[]; if(!poi) missing.push('POI'); if(!por) missing.push('POR');
    const rows = [{label:'Nationality', value:countryLine(nat)}, {label:'Requirement', value:'POI and POR are required from an unrestricted / workable region'}, {label:'Document Country', value:`Use ${countryLine(reg)} documents if this is the client’s valid registration/residence country`}, {label:'Deadline', value:'Documents must be provided within 48 hours if the restricted-country rule applies'}];
    if(missing.length) out = {cls:'conditional', title:'Documents Required', reason:`Client may proceed only after providing missing document(s): ${missing.join(' + ')}.`, blocks:[ruleBlock('Required Action', rows), block('Warnings', warnings)], warnings};
    else out = {cls:'conditional', title:'Conditional Approval', reason:'POI and POR are provided. Client may proceed subject to compliance review and document validation.', blocks:[ruleBlock('Matched Rule', rows), ruleBlock('Provided Documents', [{label:'POI', value:safeText(poi)}, {label:'POR', value:safeText(por)}]), block('Warnings', warnings)], warnings};
  } else if (inList(nat, db.rules.porRequired)) {
    const rows = [{label:'Nationality', value:countryLine(nat)}, {label:'Requirement', value:'POR is required from an unrestricted / workable region'}, {label:'POR Country', value:`POR should be from ${countryLine(reg)} if the client is registering/residing there`}];
    if(!por) out = {cls:'conditional', title:'POR Required', reason:`Client can proceed only if they provide valid POR from ${regPlain}.`, blocks:[ruleBlock('Required Action', rows), block('Warnings', warnings)], warnings};
    else out = {cls:'approved', title:'Eligible with POR', reason:'Client can proceed because POR is provided from the registration/residence country.', blocks:[ruleBlock('Matched Rule', rows), ruleBlock('Provided Document', [{label:'POR', value:safeText(por)}]), block('Warnings', warnings)], warnings};
  } else {
    const rows = [{label:'Registration', value:countryLine(reg)}, {label:'Nationality', value:countryLine(nat)}, {label:'Rule', value:'No restricted-country document exception matched in this simplified check'}];
    if(warnings.length) out = {cls:'review', title:'Platform Check Required', reason:'No general block found, but this country has a platform-specific note.', blocks:[ruleBlock('Summary', rows), block('Warnings', warnings)], warnings};
    else out = {cls:'approved', title:'Eligible', reason:'No restriction found in this simplified country check.', blocks:[ruleBlock('Summary', rows)], warnings};
  }
  out.reg = reg; out.nat = nat; out.poi = poi; out.por = por;
  return out;
}

let booted = false;
function bootApp(){
  qs('agentBadge').textContent = 'Agent: ' + (currentUser?.email?.replace('@countrycheck.local','') || 'logged in');
  qs('lastUpdated').textContent = db.lastUpdated ? `Last updated: ${db.lastUpdated}` : 'Last updated: -';
  if(!booted){
    fillCountries(); fillDocs();
    qs('checkBtn').addEventListener('click', () => check(true));
    qs('poiDoc').addEventListener('change', () => check(false));
    qs('porDoc').addEventListener('change', () => check(false));
    booted = true;
  }
  check(false);
}
function check(shouldLog=false){
  const out = evaluate();
  render(out.cls, out.title, out.reason, out.blocks);
  if(shouldLog && out.reg && out.nat) saveHistory(out);
}
async function saveHistory(out){
  const username = currentUser?.email?.replace('@countrycheck.local','') || '';
  const payload = {
    user_id: currentUser?.id,
    username,
    registration_country_code: out.reg,
    registration_country_name: plainNameOf(out.reg),
    nationality_code: out.nat,
    nationality_name: plainNameOf(out.nat),
    poi_document: out.poi || null,
    por_document: out.por || null,
    decision: out.title,
    decision_code: out.cls,
    reason: out.reason,
    warnings: out.warnings || []
  };
  await sb.from('search_history').insert(payload);
}

setupPasswordEye();
init();


const toggleBtn = qs('toggleLoginPassword');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    const input = qs('loginPassword');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    toggleBtn.setAttribute('aria-pressed', String(isHidden));
    toggleBtn.textContent = isHidden ? '🙈' : '👁';
  });
}
