import{n as e}from"./settings.js";var t=`options.html`,n=/^chrome:\/\/(newtab|new-tab-page)\b/i;function r(e){return e?e.includes(t)?!0:/^chrome:\/\//i.test(e)&&!n.test(e):!1}function i(e,t){return e.filter(e=>!r(e.url)&&!(t.excludePinned&&e.pinned)&&!(t.excludeIncognito&&e.incognito))}function a(e,t){return i(e,t).length}function o(e){return!!e&&/^https?:\/\//i.test(e)}var s=`stash`,c=50;function l(e,t,n,r){let i=e.filter(e=>e.url!==t);return i.unshift({url:t,title:r,time:n}),i.slice(0,c)}async function u(){return(await chrome.storage.local.get(`stash`)).stash??[]}async function d(e){await chrome.storage.local.set({[s]:e})}async function f(e,t,n=Date.now()){await d(l(await u(),e,n,t))}async function p(e){await d((await u()).filter(t=>t.url!==e))}async function m(){await d([])}var h=document.querySelector(`#app`),g=null;function _(e){return e.id==null?null:{id:e.id,pinned:e.pinned,incognito:e.incognito,url:e.url,windowId:e.windowId}}async function v(){let t=await e(),n=(await chrome.tabs.query(t.limitScope===`per-window`?{currentWindow:!0}:{})).map(_).filter(e=>e!==null),[r]=await chrome.tabs.query({active:!0,currentWindow:!0});return{settings:t,count:a(n,t),stash:await u(),activeTab:r?.id==null?null:{id:r.id,url:r.url,title:r.title}}}function y(e){try{let t=new URL(e),n=t.pathname===`/`?``:t.pathname;return t.hostname.replace(/^www\./,``)+n}catch{return e}}function b(e){let{settings:t,count:n,stash:r,activeTab:i}=e,a=t.maxTabs,s=n>=a,c=a>0?n/a:0,l=c>=1?`over`:c>=.8?`high`:`ok`,u=Math.max(0,a-n),d=!!i&&o(i.url);h.innerHTML=`
    <div class="header">
      <h1>TabLoop</h1>
      <span class="scope">${t.limitScope===`per-window`?`This window`:`All windows`}</span>
    </div>

    <div class="card meter ${l}">
      <div class="count"><span class="cur">${n}</span><span class="slash">/</span><span class="max">${a}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100,c*100)}%"></div></div>
      <p class="hint">${s?`At limit &mdash; stash a tab to free a slot`:`${u} slot${u===1?``:`s`} remaining`}</p>
    </div>

    <button class="stash-btn" data-act="stash-current"${d?``:` disabled`} title="${d?`Close this tab and save it to your Stash`:`This page can't be stashed`}">Stash this tab</button>

    <div class="card stash">
      <div class="stash-head">
        <span class="stash-title">Stash${r.length?` <span class="pill">${r.length}</span>`:``}</span>
        ${r.length?`<button class="link" data-act="clear">Clear all</button>`:``}
      </div>
      <ul class="stash-list"></ul>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
      <button class="link settings" data-act="settings">Settings</button>
      <button class="link escape" data-act="escape-hatch" title="Open a new tab outside the limit">Escape Hatch</button>
    </div>
  `;let f=h.querySelector(`.stash-list`);if(r.length===0){let e=document.createElement(`li`);e.className=`empty`,e.textContent=`Nothing stashed yet.`,f.append(e)}else for(let e of r)f.append(x(e,s))}function x(e,t){let n=document.createElement(`li`);n.className=`stash-item`;let r=document.createElement(`button`);r.className=`restore`,r.textContent=`Restore`,r.dataset.url=e.url,r.dataset.act=`restore`,t&&(r.disabled=!0,r.title=`Stash or close a tab to make room first`);let i=document.createElement(`span`);i.className=`url`,i.textContent=e.title?.trim()||y(e.url),i.title=e.url;let a=document.createElement(`button`);return a.className=`remove`,a.textContent=`×`,a.dataset.url=e.url,a.dataset.act=`remove`,a.title=`Remove from stash`,n.append(r,i,a),n}async function S(){g=await v(),b(g)}h.addEventListener(`click`,async e=>{let t=e.target.closest(`[data-act]`);if(!t)return;let{act:n,url:r}=t.dataset;switch(n){case`settings`:chrome.runtime.openOptionsPage(),window.close();break;case`escape-hatch`:chrome.runtime.sendMessage(`escape-hatch`),window.close();break;case`stash-current`:{let e=g?.activeTab;e&&o(e.url)&&(await f(e.url,e.title),await chrome.tabs.remove(e.id),await S());break}case`clear`:await m(),await S();break;case`remove`:r&&await p(r),await S();break;case`restore`:r&&!t.disabled&&(await chrome.tabs.create({url:r}),await p(r),window.close());break}}),S();