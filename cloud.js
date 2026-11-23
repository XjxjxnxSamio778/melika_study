
(() => {
  'use strict';
  const $ = (s, root=document) => root.querySelector(s);
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cfg = window.MELIKA_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT')
    && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_');
  const gate = $('#melika-gate'), adminRoot = $('#melika-admin'), appRoot = $('#app'), navRoot = $('#nav');
  let client=null, user=null, profile=null, saveOriginal=null, saveTimer=null, channel=null, currentAdminTab='overview';
  let chatRows=[], notesRows=[], stateLoaded=false, extraChatActive=false, chatReturnTab='today';

  function status(t){ const e=$('#cloud-status'); if(e)e.textContent=t; }
  function showGate(content){ gate.innerHTML=`<div class="gate-card">${content}</div>`;gate.style.display='block';adminRoot.style.display='none';appRoot.style.display='none';navRoot.style.display='none';}
  function showStudent(){gate.style.display='none';adminRoot.style.display='none';appRoot.style.display='';navRoot.style.display='';render();}
  function showAdmin(){gate.style.display='none';appRoot.style.display='none';navRoot.style.display='none';adminRoot.style.display='block';renderAdmin();}
  function localFallback(){
    showGate(`<h2>برنامه کنکور ملیکا</h2><p class="muted">اتصال آنلاین هنوز تنظیم نشده است. برای فعال‌شدن ورود، پنل مدیر و همگام‌سازی، اطلاعات پروژه Supabase را در فایل <b>config.js</b> وارد کن.</p><div class="admin-card"><b>حالت محلی</b><p class="muted">می‌توانی نسخه فعلی را روی همین دستگاه باز کنی؛ اطلاعات فقط در همین مرورگر ذخیره می‌شوند و از پنل مدیر قابل مشاهده نیستند.</p><button class="b" id="local-mode">ورود به نسخه محلی</button></div><div class="admin-card"><b>وضعیت اتصال</b><div class="muted">برای نسخه آنلاین، ابتدا SQL موجود در database/schema.sql را در Supabase اجرا کن و سپس دو مقدار URL و کلید عمومی را در config.js قرار بده.</div></div>`);
    $('#local-mode').onclick=()=>{gate.style.display='none';appRoot.style.display='';navRoot.style.display='';render();};
  }
  function authScreen(message=''){
    showGate(`<h2>ورود به MELIKA</h2><p class="muted">برای دسترسی به برنامه، با حساب اختصاصی خود وارد شو.</p>${message?`<p class="er">${escHtml(message)}</p>`:''}
      <label>ایمیل</label><input id="auth-email" type="email" autocomplete="username" placeholder="email@example.com">
      <label>رمز عبور</label><input id="auth-password" type="password" autocomplete="current-password" placeholder="رمز عبور">
      <button class="b" id="auth-login" style="width:100%">ورود</button><p class="muted">حساب‌ها توسط مدیر ایجاد می‌شوند؛ ثبت‌نام عمومی غیرفعال است.</p><div id="cloud-status"></div>`);
    $('#auth-login').onclick=async()=>{
      const email=$('#auth-email').value.trim(), password=$('#auth-password').value;
      if(!email||!password)return authScreen('ایمیل و رمز عبور را وارد کن.');
      const b=$('#auth-login');b.disabled=true;b.textContent='در حال ورود…';
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error){authScreen('ورود ناموفق بود: '+error.message);return;}
      await bootUser();
    };
  }
  async function bootUser(){
    const {data:{user:u}}=await client.auth.getUser(); user=u;
    if(!user){authScreen();return;}
    const {data:p,error}=await client.from('profiles').select('id,display_name,role').eq('id',user.id).maybeSingle();
    if(error||!p){await client.auth.signOut();authScreen('پروفایل حساب پیدا نشد. SQL و پروفایل را بررسی کن.');return;}
    profile=p;
    if(profile.role==='admin'){showAdmin();subscribeRealtime();}
    else {await loadStudentState();showStudent();subscribeRealtime();}
  }
  async function loadStudentState(){
    status('در حال دریافت اطلاعات ابری…');
    const {data,error}=await client.from('app_state').select('state,updated_at').eq('student_id',user.id).maybeSingle();
    if(error){status('خطا در دریافت اطلاعات: '+error.message);return;}
    if(data?.state){
      try{S=Object.assign(DEF(),data.state);S.set=Object.assign(DEF().set,S.set);localStorage.setItem('melika',JSON.stringify(S));}
      catch(e){status('ساختار اطلاعات ابری قابل خواندن نیست.');return;}
    } else {
      // First login: migrate the existing localStorage state once, without deleting it.
      const local=localStorage.getItem('melika');
      if(local){
        let parsed;try{parsed=JSON.parse(local);}catch(e){status('اطلاعات محلی JSON معتبر نیست.');return;}
        const {error:upErr}=await client.from('app_state').upsert({student_id:user.id,state:parsed,updated_at:new Date().toISOString()},{onConflict:'student_id'});
        if(upErr){status('انتقال اولیه ناموفق: '+upErr.message);return;}
      } else {
        const initial=JSON.parse(JSON.stringify(S));
        const {error:upErr}=await client.from('app_state').upsert({student_id:user.id,state:initial},{onConflict:'student_id'});
        if(upErr){status('ساخت اطلاعات اولیه ناموفق: '+upErr.message);return;}
      }
    }
    stateLoaded=true;status('اطلاعات همگام شد.');
  }
  function installSaveSync(){
    if(saveOriginal)return;
    saveOriginal=window.save;
    window.save=function(){
      saveOriginal.apply(this,arguments);
      try{localStorage.setItem('melika',JSON.stringify(S));}catch(e){}
      if(user&&profile?.role==='student'&&stateLoaded){
        clearTimeout(saveTimer);
        saveTimer=setTimeout(async()=>{
          const {error}=await client.from('app_state').upsert({student_id:user.id,state:JSON.parse(JSON.stringify(S)),updated_at:new Date().toISOString()},{onConflict:'student_id'});
          status(error?'همگام‌سازی ناموفق: '+error.message:'همگام‌سازی شد · '+new Date().toLocaleTimeString('fa-IR'));
        },650);
      }
    };
  }
  function subscribeRealtime(){
    if(!client||!user)return;
    if(channel)client.removeChannel(channel);
    channel=client.channel('melika-'+user.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:`receiver_id=eq.${user.id}`},payload=>{
        if(payload.eventType==='INSERT'){notify('پیام جدید دریافت شد');if(profile.role==='admin'&&currentAdminTab==='messages')loadChat(); if(profile.role==='student'&&extraChatActive)renderStudentExtra();}
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'admin_notes',filter:profile.role==='student'?`student_id=eq.${user.id}`:undefined},payload=>{
        if(profile.role==='student'&&payload.eventType==='INSERT'&&payload.new.visible_to_student)notify('یادداشت جدید مدیر');
        if(profile.role==='admin'&&currentAdminTab==='notes')loadNotes();
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'app_state',filter:profile.role==='student'?`student_id=eq.${user.id}`:undefined},async payload=>{
        if(profile.role==='student'&&payload.new?.state){S=Object.assign(DEF(),payload.new.state);S.set=Object.assign(DEF().set,S.set);localStorage.setItem('melika',JSON.stringify(S));render();notify('برنامه توسط مدیر به‌روزرسانی شد');}
        if(profile.role==='admin'&&currentAdminTab==='overview')renderAdmin();
      })
      .subscribe();
  }
  function notify(t){try{if('Notification'in window&&Notification.permission==='granted')new Notification('برنامه ملیکا',{body:t});}catch(e){}}
  async function requestNotifications(){if('Notification'in window&&Notification.permission==='default')await Notification.requestPermission();}

  const adminTabs=[['overview','داشبورد'],['planner','مدیریت برنامه'],['messages','پیام‌رسان'],['notes','یادداشت‌ها'],['activity','سوابق']];
  function adminShell(body){
    adminRoot.innerHTML=`<div class="admin-head"><div><h2>پنل مدیریت ملیکا</h2><div class="sm">حساب مدیر · ${escHtml(profile?.display_name||user.email)}</div></div><div class="r"><span class="tag ok">اتصال آنلاین</span><button class="b s" id="admin-notify">فعال‌سازی اعلان</button><button class="b s" id="logout">خروج</button></div></div>
      <div class="admin-nav">${adminTabs.map(([id,label])=>`<button class="b ${currentAdminTab===id?'':'s'}" data-tab="${id}">${label}</button>`).join('')}</div><div id="admin-body">${body}</div>`;
    adminRoot.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{currentAdminTab=b.dataset.tab;renderAdmin();});
    $('#logout',adminRoot).onclick=async()=>{await client.auth.signOut();location.reload();};
    $('#admin-notify',adminRoot).onclick=requestNotifications;
  }
  async function getStudentId(){
    const {data,error}=await client.from('profiles').select('id,display_name').eq('role','student').limit(1).maybeSingle();
    if(error)throw error;if(!data)throw new Error('حساب دانش‌آموزی هنوز ساخته نشده است.');return data;
  }
  async function adminState(){
    const student=await getStudentId();
    const {data,error}=await client.from('app_state').select('state,updated_at').eq('student_id',student.id).maybeSingle();
    if(error)throw error;
    return {student,state:data?.state||null,updated_at:data?.updated_at||null};
  }
  async function renderAdmin(){
    try{
      if(currentAdminTab==='overview')return adminShell(await dashboardHtml());
      if(currentAdminTab==='planner')return adminShell(await plannerHtml());
      if(currentAdminTab==='messages')return adminShell(await messagesHtml());
      if(currentAdminTab==='notes')return adminShell(await notesHtml());
      if(currentAdminTab==='activity')return adminShell(await activityHtml());
    }catch(e){adminShell(`<div class="admin-card"><h3>خطا</h3><p>${escHtml(e.message)}</p><p class="muted">بررسی کن schema.sql اجرا شده باشد و یک حساب student وجود داشته باشد.</p></div>`);}
  }
  async function dashboardHtml(){
    const {student,state,updated_at}=await adminState(),s=state||{};
    const days=s.days||{},logs=s.log||[],tests=s.tests||[],exams=s.exams||[];
    const today=new Date().toISOString().slice(0,10),week=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
    const hoursToday=logs.filter(x=>x.d===today).reduce((a,x)=>a+(+x.m||0),0);
    const hoursWeek=logs.filter(x=>x.d>=week).reduce((a,x)=>a+(+x.m||0),0);
    const testsWeek=tests.filter(x=>x.d>=week).reduce((a,x)=>a+(+x.n||0),0);
    const tasks=Object.entries(days).filter(([d])=>d<=today).flatMap(([d,a])=>(a||[]).filter(x=>!x.gone).map(x=>({...x,date:d})));
    const completed=tasks.filter(x=>x.d).length;
    return `<div class="admin-grid">
      <div class="admin-card"><h3>${Math.round(hoursToday/60*10)/10}</h3><div class="muted">ساعت مطالعه امروز</div></div>
      <div class="admin-card"><h3>${(hoursWeek/60).toFixed(1)}</h3><div class="muted">ساعت مطالعه ۷ روز اخیر</div></div>
      <div class="admin-card"><h3>${testsWeek}</h3><div class="muted">تست ثبت‌شده ۷ روز اخیر</div></div>
      <div class="admin-card"><h3>${tasks.length?Math.round(completed/tasks.length*100):0}٪</h3><div class="muted">پایبندی برنامه</div></div>
      <div class="admin-card"><h3>${exams.length}</h3><div class="muted">آزمون ثبت‌شده</div></div>
      <div class="admin-card"><h3>${tests.length}</h3><div class="muted">رکورد تست</div></div></div>
      <div class="admin-card"><h3>دانش‌آموز: ${escHtml(student.display_name||'ملیکا')}</h3><p class="muted">آخرین همگام‌سازی: ${updated_at?new Date(updated_at).toLocaleString('fa-IR'):'هنوز ثبت نشده'}</p>
      <button class="b" id="refresh-dashboard">به‌روزرسانی</button></div>
      <div class="admin-card"><h3>آخرین آزمون‌ها</h3>${exams.slice(-5).reverse().map(e=>`<div class="admin-row"><b class="grow">${escHtml(e.n||'آزمون')}</b><span>${escHtml(e.d||'')}</span><span>زیست ${e.p?.Z??'—'}٪ · فیزیک ${e.p?.P??'—'}٪ · شیمی ${e.p?.C??'—'}٪ · ریاضی ${e.p?.M??'—'}٪</span></div>`).join('')||'<p class="muted">هنوز آزمونی ثبت نشده است.</p>'}</div>`;
  }
  async function plannerHtml(){
    const {student,state}=await adminState(),days=state?.days||{};
    const today=new Date().toISOString().slice(0,10);
    const dates=Object.keys(days).filter(d=>d>=today).sort().slice(0,14);
    const chosen=dates[0]||today, rows=(days[chosen]||[]).filter(x=>!x.gone);
    return `<div class="admin-card"><h3>ویرایش برنامه روزانه</h3><p class="muted">تغییرات پس از ذخیره در حساب دانش‌آموز همگام می‌شوند.</p>
      <label>تاریخ</label><input class="admin-input" id="plan-date" type="date" value="${chosen}">
      <div id="plan-tasks">${rows.map(x=>taskEditor(x,chosen)).join('')||'<p class="muted">برای این روز فعالیتی ثبت نشده است.</p>'}</div>
      <div class="admin-row"><input id="new-task-title" class="grow" placeholder="عنوان فعالیت جدید"><input id="new-task-min" type="number" value="45" style="width:85px"><button class="b" id="add-task">افزودن فعالیت</button></div>
      <button class="b" id="save-plan">ذخیره تغییرات برنامه</button><span class="muted" id="plan-status"></span></div>`;
  }
  function taskEditor(x,date){
    return `<div class="admin-row" data-task="${escHtml(x.id)}"><input class="grow task-title" value="${escHtml(x.top||'')}" placeholder="عنوان فعالیت"><input class="task-min" type="number" value="${+x.min||30}" style="width:80px"><label><input class="task-done" type="checkbox" ${x.d?'checked':''}> انجام شد</label><button class="b s task-del">حذف</button></div>`;
  }
  async function readPlanState(){
    const {student,state}=await adminState();return {student,state:state||{days:{}}};
  }
  async function bindPlanner(){
    const dateInput=$('#plan-date',adminRoot),box=$('#plan-tasks',adminRoot);
    dateInput.onchange=async()=>{const {state}=await readPlanState(),list=(state.days?.[dateInput.value]||[]).filter(x=>!x.gone);box.innerHTML=list.map(x=>taskEditor(x,dateInput.value)).join('')||'<p class="muted">برای این روز فعالیتی ثبت نشده است.</p>';bindDelete();};
    bindDelete();
    $('#add-task',adminRoot).onclick=async()=>{
      const title=$('#new-task-title',adminRoot).value.trim();if(!title)return;
      const {student,state}=await readPlanState();state.days=state.days||{};state.days[dateInput.value]=state.days[dateInput.value]||[];
      state.days[dateInput.value].push({id:'adm'+Math.random().toString(36).slice(2,9),c:'Z',ty:'L',tm:'افزوده',min:+$('#new-task-min',adminRoot).value||45,tests:0,top:title,pr:2,d:0,act:0,mv:0});
      box.innerHTML=state.days[dateInput.value].filter(x=>!x.gone).map(x=>taskEditor(x,dateInput.value)).join('');bindDelete();
      $('#plan-status',adminRoot).textContent='فعالیت اضافه شد؛ برای ثبت نهایی ذخیره را بزن.';
      window.__pendingPlan=state;
    };
    $('#save-plan',adminRoot).onclick=async()=>{
      const {student,state}=await readPlanState();state.days=state.days||{};state.days[dateInput.value]=state.days[dateInput.value]||[];
      box.querySelectorAll('[data-task]').forEach(row=>{
        const id=row.dataset.task,x=state.days[dateInput.value].find(t=>t.id===id);if(!x)return;
        x.top=$('.task-title',row).value.trim();x.min=Math.max(1,+$('.task-min',row).value||30);x.d=$('.task-done',row).checked?1:0;
        if(row.dataset.deleted==='1')x.gone=1;
      });
      if(window.__pendingPlan?.days?.[dateInput.value])state.days[dateInput.value]=window.__pendingPlan.days[dateInput.value];
      const {error}=await client.from('app_state').upsert({student_id:student.id,state,updated_at:new Date().toISOString()},{onConflict:'student_id'});
      $('#plan-status',adminRoot).textContent=error?'خطا: '+error.message:'برنامه ذخیره شد و برای دانش‌آموز ارسال شد.';
      window.__pendingPlan=null;
      await client.from('audit_logs').insert({actor_id:user.id,action:'update_plan',details:{date:dateInput.value}});
    };
  }
  function bindDelete(){adminRoot.querySelectorAll('.task-del').forEach(b=>b.onclick=()=>{const row=b.closest('[data-task]');row.dataset.deleted='1';row.style.opacity='.35';});}
  async function messagesHtml(){
    await loadChat();
    return `<div class="admin-card"><h3>پیام‌رسان زنده</h3><div id="chat-window" class="admin-chat">${chatRows.map(m=>messageHtml(m)).join('')||'<p class="muted">هنوز پیامی وجود ندارد.</p>'}</div>
      <div class="admin-row"><input id="chat-text" class="grow" placeholder="پیام خود را بنویس…"><button class="b" id="chat-send">ارسال</button></div></div>`;
  }
  function messageHtml(m){return `<div class="msg ${m.sender_id===user.id?'mine':''}"><div>${escHtml(m.body)}</div><div class="meta">${new Date(m.created_at).toLocaleString('fa-IR')} ${m.read_at?'· خوانده‌شده':''}</div></div>`;}
  async function loadChat(){
    const {student}=await getStudentId();
    const {data,error}=await client.from('messages').select('*').or(`and(sender_id.eq.${user.id},receiver_id.eq.${student.id}),and(sender_id.eq.${student.id},receiver_id.eq.${user.id})`).order('created_at');
    if(error)throw error;chatRows=data||[];
  }
  async function bindChat(){
    $('#chat-send',adminRoot).onclick=async()=>{
      const body=$('#chat-text',adminRoot).value.trim();if(!body)return;
      const {student}=await getStudentId();const {error}=await client.from('messages').insert({sender_id:user.id,receiver_id:student.id,body});
      if(error){alert(error.message);return;}$('#chat-text',adminRoot).value='';await loadChat();$('#chat-window',adminRoot).innerHTML=chatRows.map(messageHtml).join('');$('#chat-window',adminRoot).scrollTop=999999;
    };
    $('#chat-text',adminRoot).onkeydown=e=>{if(e.key==='Enter')$('#chat-send',adminRoot).click();};
  }
  async function notesHtml(){
    await loadNotes();
    return `<div class="admin-card"><h3>یادداشت مدیریتی</h3><p class="muted">یادداشت خصوصی فقط برای مدیر است؛ برای نمایش به دانش‌آموز، گزینه مربوطه را فعال کن.</p>
      <textarea id="note-body" class="admin-input" rows="3" placeholder="یادداشت درباره روند مطالعه یا نکته مدیریتی…"></textarea>
      <label><input id="note-visible" type="checkbox"> برای دانش‌آموز قابل مشاهده باشد</label>
      <button class="b" id="note-save">ثبت یادداشت</button><div id="notes-list">${notesRows.map(noteHtml).join('')}</div></div>`;
  }
  function noteHtml(n){return `<div class="admin-row"><div class="grow"><b>${escHtml(n.body)}</b><div class="muted">${new Date(n.created_at).toLocaleString('fa-IR')} · ${n.visible_to_student?'قابل مشاهده برای دانش‌آموز':'خصوصی مدیر'}</div></div></div>`;}
  async function loadNotes(){
    const {student}=await getStudentId();
    const {data,error}=await client.from('admin_notes').select('*').eq('student_id',student.id).order('created_at',{ascending:false});
    if(error)throw error;notesRows=data||[];
  }
  async function activityHtml(){
    const {data,error}=await client.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    return `<div class="admin-card"><h3>سوابق تغییرات مدیریتی</h3>${(data||[]).map(x=>`<div class="admin-row"><b>${escHtml(x.action)}</b><span class="grow">${escHtml(JSON.stringify(x.details||{}))}</span><span class="muted">${new Date(x.created_at).toLocaleString('fa-IR')}</span></div>`).join('')||'<p class="muted">سابقه‌ای ثبت نشده است.</p>'}</div>`;
  }
  function bindAdminActions(){
    if(currentAdminTab==='planner')bindPlanner();
    if(currentAdminTab==='messages')bindChat();
    if(currentAdminTab==='notes'){
      $('#note-save',adminRoot).onclick=async()=>{
        const body=$('#note-body',adminRoot).value.trim();if(!body)return;
        const {student}=await getStudentId();const visible=$('#note-visible',adminRoot).checked;
        const {error}=await client.from('admin_notes').insert({student_id:student.id,author_id:user.id,body,visible_to_student:visible});
        if(error){alert(error.message);return;}await loadNotes();renderAdmin();
      };
    }
    if(currentAdminTab==='overview')$('#refresh-dashboard',adminRoot)?.addEventListener('click',renderAdmin);
  }
  const renderAdminBase=renderAdmin;
  renderAdmin=async function(){await renderAdminBase();bindAdminActions();};
  // Student chat and visible notes are added as a separate tab, leaving all existing study tabs intact.
  function addStudentNav(){
    const btn=document.createElement('button');btn.textContent='پیام‌ها';btn.dataset.extra='chat';btn.onclick=()=>{chatReturnTab=S.tab;extraChatActive=true;renderStudentExtra();navRoot.querySelectorAll('button').forEach(x=>x.classList.remove('on'));btn.classList.add('on');};
    navRoot.appendChild(btn);
  }
  async function renderStudentExtra(){
    appRoot.innerHTML=`<div class="c"><h2>پیام‌ها و ارتباط با مدیر</h2><div class="admin-chat" id="student-chat"></div><div class="r"><input id="student-chat-text" style="flex:1" placeholder="پیام خود را بنویس…"><button class="b" id="student-chat-send">ارسال</button></div></div><div class="c"><h2>یادداشت‌های مدیر</h2><div id="student-notes">در حال دریافت…</div></div>`;
    const {data,error}=await client.from('messages').select('*').or(`and(sender_id.eq.${user.id}),and(receiver_id.eq.${user.id})`).order('created_at');
    if(error){$('#student-chat').textContent=error.message;}else{$('#student-chat').innerHTML=(data||[]).map(messageHtml).join('')||'<p class="muted">هنوز پیامی وجود ندارد.</p>';}
    const {data:notes}=await client.from('admin_notes').select('*').eq('student_id',user.id).eq('visible_to_student',true).order('created_at',{ascending:false});
    $('#student-notes').innerHTML=(notes||[]).map(noteHtml).join('')||'<p class="muted">یادداشتی برای نمایش وجود ندارد.</p>';
    $('#student-chat-send').onclick=async()=>{
      const body=$('#student-chat-text').value.trim();if(!body)return;
      const {data:admins}=await client.from('profiles').select('id').eq('role','admin').limit(1).maybeSingle();
      if(!admins){alert('حساب مدیر پیدا نشد.');return;}
      const {error}=await client.from('messages').insert({sender_id:user.id,receiver_id:admins.id,body});
      if(error){alert(error.message);return;}$('#student-chat-text').value='';renderStudentExtra();
    };
    $('#student-chat-text').onkeydown=e=>{if(e.key==='Enter')$('#student-chat-send').click();};
  }
  const originalRender=window.render;
  window.render=function(){
    if(extraChatActive && S.tab===chatReturnTab){renderStudentExtra();return;}
    if(extraChatActive && S.tab!==chatReturnTab)extraChatActive=false;
    originalRender.apply(this,arguments);
    if(user&&profile?.role==='student'&&!navRoot.querySelector('[data-extra="chat"]'))addStudentNav();
  };
  window.save = window.save || function(){};
  // Install sync after original app has defined its functions.
  installSaveSync();
  if(!configured){localFallback();return;}
  if(!window.supabase?.createClient){localFallback();return;}
  client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  client.auth.onAuthStateChange(async(event,session)=>{
    if(event==='SIGNED_OUT'){user=null;profile=null;authScreen();}
  });
  (async()=>{const {data:{session}}=await client.auth.getSession();if(session)await bootUser();else authScreen();})();
})();
