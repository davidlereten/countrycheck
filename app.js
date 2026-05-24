// CountryCheck Email Login V5.1 - fixed UI, email-only login, no username protocol.
const SUPABASE_PROJECT_URL = "https://ftrxlqdjmtspvwupoiyq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZJ0UnfPazyYwwOIYSzKw6Q_47n9n5E6";

let supabaseClient;
let currentUser = null;
let currentProfile = null;
let countries = [];
let documents = [];
let rules = [];
let appSettings = {};

const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const appView = $("appView");
const loginForm = $("loginForm");
const loginMessage = $("loginMessage");
const emailInput = $("emailInput");
const passwordInput = $("passwordInput");
const loginBtn = $("loginBtn");

function setMessage(text, type=""){
  loginMessage.textContent = text || "";
  loginMessage.className = "message" + (type ? ` ${type}` : "");
}
function normalizeEmail(v){ return String(v || "").trim().toLowerCase(); }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

async function init(){
  try{
    if(!window.supabase) throw new Error("Supabase library could not load.");
    supabaseClient = window.supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY);
  }catch(err){
    setMessage("Supabase client could not start: " + err.message, "error");
    return;
  }

  $("togglePassword").addEventListener("click", () => {
    const shown = passwordInput.type === "text";
    passwordInput.type = shown ? "password" : "text";
    $("togglePassword").textContent = shown ? "👁" : "✕";
  });

  loginForm.addEventListener("submit", handleLogin);
  $("logoutBtn").addEventListener("click", logout);
  $("checkBtn").addEventListener("click", checkCountry);

  const { data } = await supabaseClient.auth.getSession();
  if(data?.session?.user){ await enterApp(data.session.user); }
}

async function handleLogin(e){
  e.preventDefault();
  setMessage("");
  const email = normalizeEmail(emailInput.value);
  const password = passwordInput.value;
  if(!email || !email.includes("@")) return setMessage("Please enter a valid email address.", "error");
  if(!password) return setMessage("Please enter your password.", "error");
  loginBtn.disabled = true; loginBtn.textContent = "Checking...";
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) throw error;
    if(!data?.user) throw new Error("Login failed. No user returned.");
    await enterApp(data.user);
  }catch(err){
    setMessage("Login failed: " + (err.message || "Unknown error"), "error");
  }finally{
    loginBtn.disabled = false; loginBtn.textContent = "Login";
  }
}

async function enterApp(user){
  currentUser = user;
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, username, display_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if(error) return setMessage("Profile lookup failed: " + error.message, "error");
  if(!profile || !profile.is_active){
    return setMessage("Login OK, but no active profile/role found. Run the email profile patch SQL in Supabase.", "error");
  }
  currentProfile = profile;
  loginView.classList.add("hidden"); appView.classList.remove("hidden");
  $("userEmail").textContent = user.email;
  $("userRole").textContent = profile.role;
  await loadData();
  setupRoleNav();
  showChecker();
}

async function logout(){ await supabaseClient.auth.signOut(); location.reload(); }

async function loadData(){
  const [cRes, dRes, sRes] = await Promise.all([
    supabaseClient.from("countries").select("*").eq("active", true).order("name"),
    supabaseClient.from("documents").select("*").eq("active", true).order("sort_order", { ascending:true }),
    supabaseClient.from("app_settings").select("key,value")
  ]);
  if(cRes.error) throw new Error("Could not load countries: " + cRes.error.message);
  if(dRes.error) throw new Error("Could not load documents: " + dRes.error.message);
  countries = cRes.data || [];
  documents = dRes.data || [];
  appSettings = Object.fromEntries((sRes.data || []).map(x => [x.key, x.value]));
  $("lastUpdated").textContent = appSettings.last_updated || "09 Mar 2026";

  let rRes = await supabaseClient.from("country_rules").select("*").eq("active", true);
  if(rRes.error){ rules = []; } else { rules = rRes.data || []; }
  fillSelects();
}

function fillSelects(){
  const opts = countries.map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.flag || "")} ${escapeHtml(c.name)}</option>`).join("");
  $("regCountry").innerHTML = opts;
  $("natCountry").innerHTML = opts;

  const poi = documents.filter(d => (d.doc_type || d.type) === "poi");
  const por = documents.filter(d => (d.doc_type || d.type) === "por");
  $("poiDoc").innerHTML = `<option value="">No POI provided</option>` + poi.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join("");
  $("porDoc").innerHTML = `<option value="">No POR provided</option>` + por.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join("");
  $("poiDocsList").innerHTML = poi.map(d => `<span class="chip" data-tip="${escapeHtml(d.description || 'Accepted identity document.')}">${escapeHtml(d.name)}</span>`).join("");
  $("porDocsList").innerHTML = por.map(d => `<span class="chip" data-tip="${escapeHtml(d.description || 'Accepted proof of residence document.')}">${escapeHtml(d.name)}</span>`).join("");
}

function country(code){ return countries.find(c => c.code === code) || {code, name: code}; }
function findRulesFor(code, appliesTo){
  return rules.filter(r => (r.country_code === code || r.code === code) && (!appliesTo || r.applies_to === appliesTo || r.scope === appliesTo || !r.applies_to));
}
function ruleType(r){ return String(r.rule_type || r.type || r.category || "").toLowerCase(); }

function makeDecision(input){
  const reg = country(input.reg); const nat = country(input.nat);
  const natRules = findRulesFor(input.nat, "nationality");
  const regRules = findRulesFor(input.reg, "registration").concat(findRulesFor(input.reg, "residence"));
  const allNatTypes = natRules.map(ruleType);
  const allRegTypes = regRules.map(ruleType);
  const platformNotes = regRules.concat(natRules).filter(r => ruleType(r).includes("platform") || r.platforms || r.note);

  if(allNatTypes.some(t => t.includes("direct") || t.includes("blocked") || t.includes("restricted_even") || t.includes("no_even"))){
    return {status:"Not Eligible", cls:"rejected", reason:`Nationality ${nat.name} is restricted for onboarding.`, rows:[['Nationality', nat.name], ['Rule', 'Restricted even with alternative POI/POR'], ['Note', 'Double citizenship does not matter']]};
  }
  if(allRegTypes.some(t => t.includes("direct") || t.includes("blocked") || t.includes("restricted_even") || t.includes("no_even"))){
    return {status:"Not Eligible", cls:"rejected", reason:`Registration / residence country ${reg.name} is restricted for onboarding.`, rows:[['Registration', reg.name], ['Rule', 'Restricted even with alternative POI/POR']]};
  }
  const needsBoth = allNatTypes.concat(allRegTypes).some(t => t.includes("poi_por") || t.includes("poi+por") || t.includes("both"));
  const needsPor = needsBoth || allNatTypes.concat(allRegTypes).some(t => t.includes("por_required") || t.includes("por_only") || t.includes("por"));
  if(needsBoth && (!input.poi || !input.por)){
    return {status:"POI + POR Required", cls:"conditional", reason:"Client can proceed only if valid POI and POR are provided from an unrestricted / workable region.", rows:[['Nationality', nat.name], ['Registration', reg.name], ['Requirement','POI and POR required'], ['Current status', `${input.poi ? 'POI provided' : 'Missing POI'} / ${input.por ? 'POR provided' : 'Missing POR'}`]]};
  }
  if(needsPor && !input.por){
    return {status:"POR Required", cls:"conditional", reason:`Client can proceed only if they provide valid POR from ${reg.name}.`, rows:[['Nationality', nat.name], ['Registration', reg.name], ['Requirement','POR is required from an unrestricted / workable region'], ['Current status','Missing POR']]};
  }
  if(needsBoth || needsPor){
    return {status:"Eligible with POR", cls:"approved", reason:"Client can proceed because the required document condition is satisfied.", rows:[['Nationality', nat.name], ['Registration', reg.name], ['Requirement', needsBoth ? 'POI + POR provided' : 'POR provided'], ['Provided POR', input.por || '-']]};
  }
  if(platformNotes.length){
    const note = platformNotes.map(r => r.note || r.message || `${reg.name} has platform-specific restrictions`).join(' ');
    return {status:"Platform Check Required", cls:"conditional", reason: note, rows:[['Nationality', nat.name], ['Registration', reg.name], ['Requirement','Check platform-specific restriction note']]};
  }
  return {status:"Approved", cls:"approved", reason:"No blocking restriction found.", rows:[['Nationality', nat.name], ['Registration', reg.name], ['Requirement','No additional POI/POR restriction found in the active database']]};
}

async function checkCountry(){
  const input = {reg:$("regCountry").value, nat:$("natCountry").value, poi:$("poiDoc").value, por:$("porDoc").value};
  const decision = makeDecision(input);
  renderDecision(decision);
  await supabaseClient.from("search_history").insert({
    user_id: currentUser.id,
    user_email: currentUser.email,
    role: currentProfile.role,
    registration_country_code: input.reg,
    registration_country_name: country(input.reg).name,
    nationality_country_code: input.nat,
    nationality_country_name: country(input.nat).name,
    poi_document: input.poi || null,
    por_document: input.por || null,
    decision: decision.status,
    reason: decision.reason
  });
}
function renderDecision(d){
  $("decisionBox").className = `decision-box ${d.cls || 'neutral'}`;
  $("decisionBox").innerHTML = `<h3>${escapeHtml(d.status)}</h3><p>${escapeHtml(d.reason)}</p><div class="decision-detail">${d.rows.map(([k,v])=>`<div class="detail-row"><b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span></div>`).join('')}</div>`;
}

function setupRoleNav(){
  const role = currentProfile.role;
  const nav = $("roleNav");
  const items = [{id:'checker', label:'Checker'}];
  if(role === 'moderator' || role === 'admin') items.push({id:'stats', label:'Stats'}, {id:'history', label:'Search History'}, {id:'rules', label:'Rules'}, {id:'audit', label:'Audit Logs'});
  if(role === 'admin') items.push({id:'users', label:'Users'});
  nav.innerHTML = items.map(x => `<button type="button" data-panel="${x.id}">${x.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));
  nav.querySelector('[data-panel="checker"]')?.classList.add('active');
}
function showChecker(){ showPanel('checker'); }
async function showPanel(panel){
  document.querySelectorAll('.role-nav button').forEach(b=>b.classList.toggle('active', b.dataset.panel===panel));
  $("checkerSection").classList.toggle('hidden', panel !== 'checker');
  $("adminSection").classList.toggle('hidden', panel === 'checker');
  if(panel === 'checker') return;
  if(panel === 'stats') return renderStats();
  if(panel === 'history') return renderHistory();
  if(panel === 'rules') return renderRules();
  if(panel === 'audit') return renderAudit();
  if(panel === 'users') return renderUsers();
}
async function renderStats(){
  $("adminTitle").textContent = "Database Statistics";
  const { count: hCount } = await supabaseClient.from('search_history').select('*', {count:'exact', head:true});
  const { count: uCount } = await supabaseClient.from('profiles').select('*', {count:'exact', head:true});
  const { count: rCount } = await supabaseClient.from('country_rules').select('*', {count:'exact', head:true});
  $("adminContent").innerHTML = `<div class="stat-grid"><div class="stat"><span>Total checks</span><strong>${hCount ?? 0}</strong></div><div class="stat"><span>Users</span><strong>${uCount ?? 0}</strong></div><div class="stat"><span>Rules</span><strong>${rCount ?? 0}</strong></div><div class="stat"><span>Role</span><strong>${escapeHtml(currentProfile.role)}</strong></div></div>`;
}
async function renderHistory(){
  $("adminTitle").textContent = "Search History";
  const {data, error}=await supabaseClient.from('search_history').select('*').order('created_at',{ascending:false}).limit(80);
  if(error) return $("adminContent").textContent = error.message;
  $("adminContent").innerHTML = table(data, ['created_at','user_email','registration_country_name','nationality_country_name','poi_document','por_document','decision']);
}
async function renderRules(){
  $("adminTitle").textContent = "Rules Database";
  const {data, error}=await supabaseClient.from('country_rules').select('*').order('country_name');
  if(error) return $("adminContent").textContent = error.message;
  $("adminContent").innerHTML = `<p class="small-note">Rule editing and bulk import will be enabled here after Edge Function permissions are deployed.</p>` + table(data, ['country_name','country_code','rule_type','applies_to','note','active']);
}
async function renderAudit(){
  $("adminTitle").textContent = "Audit Logs";
  const {data, error}=await supabaseClient.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(80);
  if(error) return $("adminContent").textContent = error.message;
  $("adminContent").innerHTML = table(data, ['created_at','actor_email','actor_role','action_type','target_table','target_name']);
}
async function renderUsers(){
  $("adminTitle").textContent = "Users";
  const {data, error}=await supabaseClient.from('profiles').select('*').order('created_at',{ascending:false});
  if(error) return $("adminContent").textContent = error.message;
  $("adminContent").innerHTML = `<p class="small-note">Auth user create/delete/reset password must be done through the secured Edge Function. Until deployed, manage Auth users in Supabase Authentication.</p>` + table(data, ['created_at','username','display_name','role','is_active']);
}
function table(rows, cols){
  if(!rows || !rows.length) return '<p class="small-note">No records found.</p>';
  return `<div style="overflow:auto"><table class="admin-table"><thead><tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

init();
