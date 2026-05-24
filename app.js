// CountryCheck V5.3 - restored checker UI, admin dashboard scaling, admin user management, live activity.
const SUPABASE_PROJECT_URL = "https://ftrxlqdjmtspvwupoiyq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZJ0UnfPazyYwwOIYSzKw6Q_47n9n5E6";
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

let supabaseClient;
let currentUser = null;
let currentProfile = null;
let countries = [];
let documents = [];
let rules = [];
let settings = {};
let presenceTimer = null;

const $ = (id) => document.getElementById(id);
const escapeHtml = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

function setMessage(text, type=''){
  const el = $('loginMessage');
  if(!el) return;
  el.textContent = text || '';
  el.className = 'message' + (type ? ` ${type}` : '');
}

async function init(){
  try{
    if(!window.supabase) throw new Error('Supabase library could not load.');
    supabaseClient = window.supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY);
  }catch(err){ setMessage('Supabase client could not start: ' + err.message, 'error'); return; }

  $('togglePassword')?.addEventListener('click', () => {
    const shown = $('passwordInput').type === 'text';
    $('passwordInput').type = shown ? 'password' : 'text';
    $('togglePassword').textContent = shown ? '👁' : '✕';
  });
  $('loginForm')?.addEventListener('submit', handleLogin);
  $('logoutBtn')?.addEventListener('click', async () => { await updatePresence('logout', 'Logged out'); await supabaseClient.auth.signOut(); location.reload(); });
  $('checkBtn')?.addEventListener('click', checkCountry);

  const { data } = await supabaseClient.auth.getSession();
  if(data?.session?.user) await enterApp(data.session.user);
}

async function handleLogin(e){
  e.preventDefault();
  setMessage('');
  const email = normalizeEmail($('emailInput').value);
  const password = $('passwordInput').value;
  if(!email || !email.includes('@')) return setMessage('Please enter a valid email address.', 'error');
  if(!password) return setMessage('Please enter your password.', 'error');
  $('loginBtn').disabled = true; $('loginBtn').textContent = 'Checking...';
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;
    if(!data?.user) throw new Error('Login failed. No user returned.');
    await enterApp(data.user);
  }catch(err){
    setMessage('Login failed: ' + (err.message || 'Unknown error'), 'error');
  }finally{
    $('loginBtn').disabled = false; $('loginBtn').textContent = 'Login';
  }
}

async function enterApp(user){
  currentUser = user;
  const { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(error) return setMessage('Profile lookup failed: ' + error.message, 'error');
  if(!profile || !profile.is_active) return setMessage('Login OK, but no active profile/role found. Run the profile patch SQL in Supabase.', 'error');
  currentProfile = profile;
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('userEmail').textContent = user.email;
  $('userRole').textContent = profile.role;
  await loadData();
  setupNav();
  await updatePresence('checker', 'Logged in');
  presenceTimer = setInterval(() => updatePresence(currentPanel(), 'Active'), 45000);
  await showPanel('checker');
}

function currentPanel(){ return document.querySelector('.tabs button.active')?.dataset.panel || 'checker'; }

async function updatePresence(page='checker', action='Active', lastCheck=null){
  if(!currentUser || !supabaseClient) return;
  try{
    await supabaseClient.rpc('touch_presence', {
      p_current_page: page,
      p_last_action: action,
      p_last_check: lastCheck || null
    });
  }catch(e){ console.warn('Presence update failed:', e.message || e); }
}

async function loadData(){
  const [cRes, dRes, rRes, sRes] = await Promise.all([
    supabaseClient.from('countries').select('*').eq('active', true).order('name'),
    supabaseClient.from('documents').select('*').eq('active', true).order('doc_type').order('name'),
    supabaseClient.from('country_rules').select('*').eq('active', true),
    supabaseClient.from('app_settings').select('key,value')
  ]);
  if(cRes.error) throw new Error('Could not load countries: ' + cRes.error.message);
  if(dRes.error) throw new Error('Could not load documents: ' + dRes.error.message);
  countries = cRes.data || [];
  documents = dRes.data || [];
  rules = rRes.error ? [] : (rRes.data || []);
  settings = Object.fromEntries((sRes.data || []).map(x => [x.key, x.value]));
  $('lastUpdated').textContent = settings.last_updated || '09 Mar 2026';
  fillDocs();
  makeCountryPicker('regCountry', 'regCountryPicker', countries.find(c=>c.code==='BS')?.code || countries[0]?.code || 'BS');
  makeCountryPicker('natCountry', 'natCountryPicker', countries.find(c=>c.code==='FR')?.code || countries[0]?.code || 'FR');
}

function flagIcon(code, alt=''){
  if(!code) return '<span class="flag-fallback">?</span>';
  if(String(code).length !== 2) return '<span class="flag-fallback">•</span>';
  const lower = String(code).toLowerCase();
  return `<img class="flag-img" alt="${escapeHtml(alt || code)} flag" src="https://flagcdn.com/w40/${lower}.png" srcset="https://flagcdn.com/w80/${lower}.png 2x" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'flag-fallback',textContent:'${escapeHtml(code)}'}))">`;
}
function country(code){ return countries.find(c => c.code === code) || {code, name: code}; }
function countryLine(code){ const c = country(code); return `<span class="country-line">${flagIcon(c.code, c.name)}<span>${escapeHtml(c.name)}</span></span>`; }

function makeCountryPicker(hiddenId, pickerId, defaultCode){
  const hidden = $(hiddenId), picker = $(pickerId);
  if(!hidden || !picker) return;
  let selected = hidden.value || defaultCode || countries[0]?.code;
  hidden.value = selected;
  const renderButton = () => {
    const c = country(selected);
    return `<button type="button" class="country-btn"><span class="country-selected">${flagIcon(c.code,c.name)}<span>${escapeHtml(c.name)}</span></span><span class="chev">▾</span></button>`;
  };
  const renderOptions = (query='') => {
    const q = query.trim().toLowerCase();
    return countries.filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .map(c => `<button type="button" class="country-option ${c.code===selected?'active':''}" data-code="${escapeHtml(c.code)}">${flagIcon(c.code,c.name)}<span>${escapeHtml(c.name)}</span></button>`).join('') || '<div class="mini" style="padding:12px">No country found.</div>';
  };
  const draw = (query='') => {
    picker.innerHTML = renderButton() + `<div class="country-menu"><input class="country-search" placeholder="Search country..." value="${escapeHtml(query)}"><div class="country-options">${renderOptions(query)}</div></div>`;
  };
  draw();
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.country-btn');
    const opt = e.target.closest('.country-option');
    if(btn){ picker.classList.toggle('open'); setTimeout(()=>picker.querySelector('.country-search')?.focus(),20); }
    if(opt){ selected = opt.dataset.code; hidden.value = selected; picker.classList.remove('open'); draw(); }
  });
  picker.addEventListener('input', (e) => { if(e.target.classList.contains('country-search')) picker.querySelector('.country-options').innerHTML = renderOptions(e.target.value); });
  document.addEventListener('click', (e)=>{ if(!picker.contains(e.target)) picker.classList.remove('open'); });
}

function fillDocs(){
  const poi = documents.filter(d => d.doc_type === 'poi');
  const por = documents.filter(d => d.doc_type === 'por');
  $('poiDoc').innerHTML = '<option value="">No POI provided</option>' + poi.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
  $('porDoc').innerHTML = '<option value="">No POR provided</option>' + por.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
  $('poiDocsList').innerHTML = poi.map(d => `<span class="pill doc-tip" tabindex="0" data-tip="${escapeHtml(d.description || 'Accepted identity document.')}">${escapeHtml(d.name)}</span>`).join('');
  $('porDocsList').innerHTML = por.map(d => `<span class="pill doc-tip" tabindex="0" data-tip="${escapeHtml(d.description || 'Accepted proof of residence document.')}">${escapeHtml(d.name)}</span>`).join('');
}

function rulesFor(code, applies){ return rules.filter(r => r.country_code === code && (!applies || r.applies_to === applies)); }
function typeOf(r){ return String(r.rule_type || '').toLowerCase(); }
function hasType(ruleList, patterns){ return ruleList.some(r => patterns.some(p => typeOf(r).includes(p))); }

function makeDecision(input){
  const reg = country(input.reg), nat = country(input.nat);
  const natRules = rulesFor(input.nat, 'nationality');
  const regRules = rulesFor(input.reg, 'registration').concat(rulesFor(input.reg, 'residence'));
  const all = natRules.concat(regRules);
  const platform = all.filter(r => typeOf(r).includes('platform') || (r.platforms && r.platforms.length));

  if(hasType(natRules, ['direct_restricted','restricted','no_even'])) return {status:'Not Eligible', cls:'rejected', reason:`Nationality ${nat.name} is restricted for onboarding.`, rows:[['Nationality', countryLine(input.nat)], ['Rule','Restricted even with alternative POI/POR'], ['Note','Double citizenship does not matter']]};
  if(hasType(regRules, ['direct_restricted','restricted','no_even'])) return {status:'Not Eligible', cls:'rejected', reason:`Registration / residence country ${reg.name} is restricted for onboarding.`, rows:[['Registration', countryLine(input.reg)], ['Rule','Restricted even with alternative POI/POR']]};

  const needsBoth = hasType(all, ['poi_por_required']);
  const needsPor = needsBoth || hasType(all, ['por_required']);
  if(needsBoth && (!input.poi || !input.por)) return {status:'POI + POR Required', cls:'conditional', reason:'Client can proceed only if valid POI and POR are provided from an unrestricted / workable region.', rows:[['Nationality', countryLine(input.nat)], ['Registration', countryLine(input.reg)], ['Requirement','POI and POR are required'], ['Current status', `${input.poi ? 'POI provided' : 'Missing POI'} / ${input.por ? 'POR provided' : 'Missing POR'}`]]};
  if(needsPor && !input.por) return {status:'POR Required', cls:'conditional', reason:`Client can proceed only if they provide valid POR from ${reg.name}.`, rows:[['Nationality', countryLine(input.nat)], ['Requirement','POR is required from an unrestricted / workable region'], ['POR Country', `POR should be from ${countryLine(input.reg)} if the client is registering/residing there`]]};
  if(needsBoth || needsPor) return {status:'Eligible with POR', cls:'approved', reason:'Client can proceed because the required document condition is satisfied.', rows:[['Nationality', countryLine(input.nat)], ['Registration', countryLine(input.reg)], ['Requirement', needsBoth ? 'POI + POR provided' : 'POR provided'], ['Provided POR', input.por || '-']]};

  if(platform.length){
    const note = platform.map(r => r.note || (Array.isArray(r.platforms) && r.platforms.length ? `Blocked for ${r.platforms.join(', ')}` : 'Platform-specific restriction applies')).join(' ');
    return {status:'Platform Check Required', cls:'conditional', reason: note, rows:[['Registration', countryLine(input.reg)], ['Requirement','Check the platform-specific note before onboarding']]};
  }
  return {status:'Approved', cls:'approved', reason:'No blocking restriction found.', rows:[['Nationality', countryLine(input.nat)], ['Registration', countryLine(input.reg)], ['Requirement','No additional POI/POR restriction found in the active database']]};
}

function renderDecision(d){
  $('decisionBox').className = `result ${d.cls || 'neutral'}`;
  $('decisionBox').innerHTML = `<div class="status"><span class="dot"></span><strong>${escapeHtml(d.status)}</strong></div><div class="reason">${escapeHtml(d.reason)}</div><div class="rule-card">${d.rows.map(([k,v])=>`<div class="rule-row"><div class="rule-key">${escapeHtml(k)}</div><div class="rule-value">${String(v).includes('<span') ? v : escapeHtml(v)}</div></div>`).join('')}</div>`;
}

async function checkCountry(){
  const input = {reg:$('regCountry').value, nat:$('natCountry').value, poi:$('poiDoc').value, por:$('porDoc').value};
  const decision = makeDecision(input);
  renderDecision(decision);
  const payload = {
    user_id: currentUser.id,
    username: currentProfile.username || currentUser.email,
    role: currentProfile.role,
    registration_country: country(input.reg).name,
    registration_country_code: input.reg,
    nationality: country(input.nat).name,
    nationality_code: input.nat,
    poi_document: input.poi || null,
    por_document: input.por || null,
    decision: decision.status,
    reason: decision.reason,
    details: { rows: decision.rows.map(([k,v]) => [k, String(v).replace(/<[^>]+>/g,'')]) }
  };
  const { error } = await supabaseClient.from('search_history').insert(payload);
  if(error) console.warn('Search history insert failed:', error.message);
  await updatePresence('checker', `Checked ${payload.registration_country} / ${payload.nationality}`, payload);
}

function setupNav(){
  const nav = $('roleNav');
  const role = currentProfile.role;
  const items = [{id:'checker', label:'Checker'}, {id:'account', label:'Account'}];
  if(role === 'moderator') items.push({id:'rules', label:'Rules'}, {id:'bulk', label:'Bulk Import'});
  if(role === 'admin') items.push({id:'dashboard', label:'Dashboard'}, {id:'users', label:'Users'}, {id:'rules', label:'Rules'}, {id:'bulk', label:'Bulk Import'}, {id:'history', label:'Search History'}, {id:'audit', label:'Audit Logs'});
  nav.innerHTML = items.map(i => `<button type="button" data-panel="${i.id}">${i.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.panel)));
}

async function showPanel(panel){
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
  $('checkerSection').classList.toggle('hidden', panel !== 'checker');
  $('adminSection').classList.toggle('hidden', panel === 'checker');
  await updatePresence(panel, `Opened ${panel}`);
  if(panel === 'checker') return;
  if(panel === 'account') return renderAccount();
  if(panel === 'dashboard') return renderDashboard();
  if(panel === 'users') return renderUsers();
  if(panel === 'rules') return renderRules();
  if(panel === 'bulk') return renderBulk();
  if(panel === 'history') return renderHistory();
  if(panel === 'audit') return renderAudit();
}

async function renderAccount(){
  $('adminTitle').textContent = 'Account';
  $('adminContent').innerHTML = `<div class="admin-box narrow-box"><h3>Change your password</h3><p class="mini">This only changes your own login password.</p><div class="admin-form two"><input id="ownPass1" type="password" placeholder="New password"><input id="ownPass2" type="password" placeholder="Repeat password"><button id="ownPassBtn" class="check-btn" type="button">Update Password</button></div><div id="ownPassMsg" class="message"></div></div>`;
  $('ownPassBtn').addEventListener('click', async () => {
    const p1 = $('ownPass1').value, p2 = $('ownPass2').value;
    if(!p1 || p1.length < 8){ $('ownPassMsg').className='message error'; $('ownPassMsg').textContent='Password must be at least 8 characters.'; return; }
    if(p1 !== p2){ $('ownPassMsg').className='message error'; $('ownPassMsg').textContent='Passwords do not match.'; return; }
    const { error } = await supabaseClient.auth.updateUser({ password: p1 });
    if(error){ $('ownPassMsg').className='message error'; $('ownPassMsg').textContent=error.message; return; }
    $('ownPassMsg').className='message ok'; $('ownPassMsg').textContent='Password updated.';
    await updatePresence('account','Changed own password');
  });
}

function countDecision(rows, matcher){ return rows.filter(r => matcher(String(r.decision || ''))).length; }
function isOnline(p){ return p?.last_seen_at && (Date.now() - new Date(p.last_seen_at).getTime()) < ONLINE_WINDOW_MS; }
function formatTime(v){ if(!v) return '-'; try{return new Date(v).toLocaleString();}catch{return String(v);} }

async function renderDashboard(){
  $('adminTitle').textContent = 'Dashboard';
  const [hist, profs] = await Promise.all([
    supabaseClient.from('search_history').select('created_at,username,registration_country,nationality,decision').order('created_at',{ascending:false}).limit(5000),
    supabaseClient.from('profiles').select('email,username,display_name,role,is_active,last_seen_at,current_page,last_action,last_check').order('last_seen_at',{ascending:false})
  ]);
  if(hist.error) return showAdminError('Dashboard could not load. Make sure you are logged in as admin and policy patch is installed.', hist.error);
  const rows = hist.data || [];
  const profiles = profs.data || [];
  const today = new Date().toISOString().slice(0,10);
  const total = rows.length;
  const todayCount = rows.filter(r => String(r.created_at||'').slice(0,10) === today).length;
  const approved = countDecision(rows, d => /approved|eligible/i.test(d) && !/not/i.test(d));
  const declined = countDecision(rows, d => /not eligible|rejected|decline/i.test(d));
  const conditional = countDecision(rows, d => /required|conditional|platform/i.test(d));
  const online = profiles.filter(isOnline).length;
  const activeUsers = profiles.filter(p=>p.is_active).length;
  const onlineRows = profiles.filter(p => isOnline(p)).slice(0,10).map(p => ({ user: p.email || p.username, role:p.role, page:p.current_page || '-', last_action:p.last_action || '-', last_seen: formatTime(p.last_seen_at) }));
  $('adminContent').innerHTML = `
    <div class="admin-grid compact-stats">
      <div class="stat"><span>Total checks</span><strong>${total}</strong></div>
      <div class="stat"><span>Today checks</span><strong>${todayCount}</strong></div>
      <div class="stat"><span>Approved / eligible</span><strong>${approved}</strong></div>
      <div class="stat"><span>Declined / not eligible</span><strong>${declined}</strong></div>
      <div class="stat"><span>Conditional</span><strong>${conditional}</strong></div>
      <div class="stat"><span>Online users</span><strong>${online}</strong></div>
      <div class="stat"><span>Active users</span><strong>${activeUsers}</strong></div>
      <div class="stat"><span>Rules</span><strong>${rules.length}</strong></div>
    </div>
    <div class="dashboard-grid">
      <div class="admin-box"><h3>Most searched registration countries</h3>${rankTable(rows, 'registration_country')}</div>
      <div class="admin-box"><h3>Most searched nationalities</h3>${rankTable(rows, 'nationality')}</div>
      <div class="admin-box"><h3>Decision distribution</h3>${rankTable(rows, 'decision')}</div>
      <div class="admin-box"><h3>Live users</h3>${table(onlineRows, ['user','role','page','last_action','last_seen'], false)}</div>
      <div class="admin-box wide"><h3>Last checks</h3>${table(rows.slice(0,12).map(r=>({created_at:formatTime(r.created_at),username:r.username,registration_country:r.registration_country,nationality:r.nationality,decision:r.decision})), ['created_at','username','registration_country','nationality','decision'], false)}</div>
    </div>`;
}

function rankTable(rows, key){
  const counts = {};
  rows.forEach(r => { const v = r[key] || '-'; counts[v] = (counts[v] || 0) + 1; });
  const ranked = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({name,count}));
  return table(ranked, ['name','count'], false);
}

async function adminInvoke(action, payload={}){
  const { data, error } = await supabaseClient.functions.invoke('admin-users', { body: { action, ...payload } });
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data;
}

async function renderUsers(){
  $('adminTitle').textContent = 'Users';
  let users = [];
  let edgeError = null;
  try{
    const res = await adminInvoke('list_users');
    users = res.users || [];
  }catch(e){
    edgeError = e;
    const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at',{ascending:false});
    if(error) return showAdminError('Users could not load. Install V5.3 SQL patch and deploy the admin-users Edge Function.', error);
    users = data || [];
  }
  const rows = users.map(u => ({
    status: isOnline(u) ? 'Online' : 'Offline',
    email: u.email || '',
    display_name: u.display_name || '',
    role: u.role || 'agent',
    active: u.is_active === false ? 'Passive' : 'Active',
    last_action: u.last_action || '-',
    last_seen: formatTime(u.last_seen_at),
    actions: `<button class="mini-action" data-act="rename" data-id="${escapeHtml(u.id)}">Name</button><button class="mini-action" data-act="email" data-id="${escapeHtml(u.id)}">Email</button><button class="mini-action" data-act="pass" data-id="${escapeHtml(u.id)}">Password</button><button class="mini-action" data-act="role" data-id="${escapeHtml(u.id)}">Role</button><button class="mini-action" data-act="active" data-id="${escapeHtml(u.id)}" data-active="${u.is_active === false ? 'false':'true'}">${u.is_active === false ? 'Activate':'Deactivate'}</button><button class="mini-action danger" data-act="delete" data-id="${escapeHtml(u.id)}">Delete</button>`
  }));
  $('adminContent').innerHTML = `
    ${edgeError ? `<div class="message error">Admin user actions need Edge Function deployment. Current fallback only lists profiles. Error: ${escapeHtml(edgeError.message || edgeError)}</div>` : ''}
    <div class="admin-box"><h3>Create user</h3><div class="admin-form four"><input id="newUserEmail" type="email" placeholder="email@domain.com"><input id="newUserName" placeholder="Display name"><select id="newUserRole"><option value="agent">agent</option><option value="moderator">moderator</option><option value="admin">admin</option></select><input id="newUserPass" type="password" placeholder="Temporary password"><button id="createUserBtn" type="button" class="check-btn">Create User</button></div><div id="userMsg" class="message"></div></div>
    <div class="admin-box"><h3>User management</h3>${table(rows, ['status','email','display_name','role','active','last_action','last_seen','actions'], true)}</div>`;
  $('createUserBtn')?.addEventListener('click', createUser);
  $('adminContent').querySelectorAll('.mini-action').forEach(btn => btn.addEventListener('click', handleUserAction));
}

async function createUser(){
  const msg = $('userMsg');
  try{
    const email = normalizeEmail($('newUserEmail').value);
    const display_name = $('newUserName').value.trim();
    const role = $('newUserRole').value;
    const password = $('newUserPass').value;
    if(!email || !email.includes('@')) throw new Error('Enter a valid email.');
    if(!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
    await adminInvoke('create_user', { email, display_name, role, password });
    msg.className = 'message ok'; msg.textContent = 'User created.';
    await renderUsers();
  }catch(e){ msg.className='message error'; msg.textContent = e.message || String(e); }
}

async function handleUserAction(e){
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try{
    if(act === 'rename'){
      const display_name = prompt('New display name:'); if(display_name === null) return;
      await adminInvoke('update_user', { user_id:id, display_name });
    } else if(act === 'email'){
      const email = normalizeEmail(prompt('New email address:') || ''); if(!email) return;
      await adminInvoke('update_user', { user_id:id, email });
    } else if(act === 'pass'){
      const password = prompt('New password, min 8 characters:'); if(!password) return;
      await adminInvoke('update_user', { user_id:id, password });
    } else if(act === 'role'){
      const role = prompt('Role: agent, moderator, admin'); if(!role) return;
      await adminInvoke('update_user', { user_id:id, role });
    } else if(act === 'active'){
      const is_active = btn.dataset.active !== 'true';
      await adminInvoke('update_user', { user_id:id, is_active });
    } else if(act === 'delete'){
      if(!confirm('Delete this user permanently?')) return;
      await adminInvoke('delete_user', { user_id:id });
    }
    await renderUsers();
  }catch(err){ alert('User action failed: ' + (err.message || err)); }
}

async function renderHistory(){
  $('adminTitle').textContent = 'Search History';
  const { data, error } = await supabaseClient.from('search_history').select('*').order('created_at',{ascending:false}).limit(300);
  if(error) return showAdminError('Search history could not load. Only admin can view search history.', error);
  $('adminContent').innerHTML = table((data||[]).map(r=>({...r, created_at:formatTime(r.created_at)})), ['created_at','username','role','registration_country','nationality','poi_document','por_document','decision'], false);
}

async function renderAudit(){
  $('adminTitle').textContent = 'Audit Logs';
  const { data, error } = await supabaseClient.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(300);
  if(error) return showAdminError('Audit logs could not load. Only admin can view audit logs.', error);
  $('adminContent').innerHTML = `<p class="mini"><b>Audit Logs</b> records admin/moderator changes: rule created, updated, deleted, bulk import, user creation, password reset, role/profile changes. It is the accountability trail.</p>${table((data||[]).map(r=>({...r, created_at:formatTime(r.created_at)})), ['created_at','actor_username','actor_role','action_type','target_table','target_name'], false)}`;
}

async function renderRules(){
  $('adminTitle').textContent = 'Rules Database';
  const canEdit = ['admin','moderator'].includes(currentProfile.role);
  const form = canEdit ? `<div class="admin-box"><h3>Add restriction / note</h3><div class="admin-form"><select id="ruleCountry">${countries.map(c=>`<option value="${escapeHtml(c.code)}">${escapeHtml(c.name)}</option>`).join('')}</select><select id="ruleApplies"><option value="nationality">Nationality</option><option value="registration">Registration</option><option value="residence">Residence</option></select><select id="ruleType"><option value="direct_restricted">Direct restricted</option><option value="poi_por_required">POI + POR required</option><option value="por_required">POR required</option><option value="platform_block">Platform block / warning</option><option value="note">Note</option></select><textarea id="ruleNote" placeholder="Note / warning text"></textarea><button id="addRuleBtn" class="check-btn" type="button">Add Rule</button></div></div>` : '';
  $('adminContent').innerHTML = form + table(rules.slice().sort((a,b)=>String(a.country_name).localeCompare(String(b.country_name))), ['id','country_name','country_code','applies_to','rule_type','note','active'], false);
  if(canEdit) $('addRuleBtn')?.addEventListener('click', addRule);
}

async function addRule(){
  const code = $('ruleCountry').value;
  const c = country(code);
  const payload = { country_code: code, country_name: c.name, applies_to: $('ruleApplies').value, rule_type: $('ruleType').value, note: $('ruleNote').value || '', active: true };
  const { error } = await supabaseClient.from('country_rules').insert(payload);
  if(error) return alert('Rule add failed: ' + error.message);
  await updatePresence('rules', `Added rule for ${c.name}`);
  await loadData(); await renderRules();
}

function renderBulk(){
  $('adminTitle').textContent = 'Bulk Import';
  $('adminContent').innerHTML = `<div class="admin-box"><p class="mini">CSV format: country_code,country_name,applies_to,rule_type,note,active</p><textarea id="csvInput" placeholder="FR,France,nationality,por_required,POR required from unrestricted/workable region,true"></textarea><button id="bulkBtn" class="check-btn" type="button">Import CSV</button><div id="bulkMsg" class="message"></div></div>`;
  $('bulkBtn').addEventListener('click', bulkImport);
}

async function bulkImport(){
  const text = $('csvInput').value.trim();
  if(!text) return;
  const lines = text.split(/\r?\n/).filter(Boolean);
  const payload = lines.map(line => {
    const parts = parseCSVLine(line);
    return { country_code: parts[0], country_name: parts[1], applies_to: parts[2], rule_type: parts[3], note: parts[4] || '', active: String(parts[5] ?? 'true').toLowerCase() !== 'false' };
  }).filter(r => r.country_code && r.country_name && r.applies_to && r.rule_type);
  const { error } = await supabaseClient.from('country_rules').insert(payload);
  if(error) { $('bulkMsg').className='message error'; $('bulkMsg').textContent = error.message; return; }
  $('bulkMsg').className='message ok'; $('bulkMsg').textContent = `${payload.length} rules imported.`;
  await updatePresence('bulk', `Imported ${payload.length} rules`);
  await loadData();
}
function parseCSVLine(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ q=!q; continue; } if(ch===',' && !q){ out.push(cur.trim()); cur=''; } else cur+=ch; }
  out.push(cur.trim()); return out;
}

function showAdminError(label, error){ $('adminContent').innerHTML = `<p class="danger-text">${escapeHtml(label)}</p><p class="mini">${escapeHtml(error.message || error)}</p>`; }
function table(rows, cols, allowHtml=false){
  if(!rows || !rows.length) return '<p class="empty-state">No records found.</p>';
  return `<div class="scroll-x"><table class="admin-table"><thead><tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${allowHtml && c === 'actions' ? (r[c] || '') : escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

init();
