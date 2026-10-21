(()=>{'use strict';
if(!['kazuar.in.ua','www.kazuar.in.ua'].includes(location.hostname.toLowerCase())||location.pathname.toLowerCase()!=='/pilot-cabinet.html')return;
const URL='https://raw.githubusercontent.com/kazuar-avia/kazuar-avia.github.io/main/COMPANY/maintenance.json';
const BACKUP='https://kazuar-avia.github.io/pilot-cabinet.html';
const hide=document.createElement('style');hide.textContent='html.ucaa-maintenance-check body{visibility:hidden!important}';document.head.append(hide);document.documentElement.classList.add('ucaa-maintenance-check');
const reveal=()=>document.documentElement.classList.remove('ucaa-maintenance-check');
let active=false,checking=false;
function maintenance(){
if(active)return;active=true;
const draw=()=>{
if(!document.body||document.getElementById('ucaa-maintenance'))return;
const styles=document.createElement('style');styles.textContent=`
#ucaa-maintenance,#ucaa-maintenance *{box-sizing:border-box}
#ucaa-maintenance{position:fixed;inset:0;z-index:2147483647;background:#fff;color:#111;overflow:auto;display:flex;justify-content:center;align-items:center;padding:10px 8px 28px;font:14px Arial,sans-serif}
#ucaa-maintenance .page{width:100%;max-width:680px;margin:auto;border:1px solid #555;background:#fff}
#ucaa-maintenance .bar{background:#caeef2;border-bottom:1px solid #555;padding:15px 18px;display:flex;align-items:center;justify-content:center;gap:13px;text-align:center;margin:0;min-height:unset}
#ucaa-maintenance .tool{width:47px;height:47px;flex:0 0 47px;display:grid;place-items:center;border:1px solid #a9d8df;border-radius:12px;background:#fff}
#ucaa-maintenance .tool svg{width:29px;height:29px;display:block}
#ucaa-maintenance h1{font:700 21px/1.2 Arial,sans-serif;margin:0;color:#111}
#ucaa-maintenance .content{padding:33px 25px 38px;display:flex;flex-direction:column;align-items:center}
#ucaa-maintenance .message{font:400 16px/1.5 Arial,sans-serif;margin:0;text-align:center}
#ucaa-maintenance .countdown{width:min(100%,360px);min-height:61px;margin-top:26px;padding:12px 16px;border:1px solid #555;background:#fffbe3;display:flex;align-items:center;justify-content:center;gap:13px;text-align:center}
#ucaa-maintenance .spinner{width:22px;height:22px;flex:0 0 22px;border:3px solid #d2dbd6;border-top-color:#0b6f7a;border-radius:50%;animation:ucaa-spin .8s linear infinite}
@keyframes ucaa-spin{to{transform:rotate(360deg)}}
#ucaa-maintenance .countdown-text{font:400 15px/1.3 Arial,sans-serif}
#ucaa-maintenance .seconds{display:inline-block;min-width:17px;font-weight:700;font-size:23px;line-height:1;font-variant-numeric:tabular-nums}
#ucaa-maintenance .backup{margin-top:22px;min-height:42px;border:1px solid #555;background:#caeef2;color:#111;padding:10px 17px;display:inline-flex;gap:10px;align-items:center;justify-content:center;font:700 14px Arial,sans-serif;text-decoration:none;text-align:center}
#ucaa-maintenance .backup:hover{background:#ffee8c}
#ucaa-maintenance .backup:focus-visible{outline:3px solid #0645ad;outline-offset:3px}
#ucaa-maintenance .backup svg{width:17px;height:17px;flex:0 0 17px}
@media(max-width:520px){#ucaa-maintenance .bar{padding:13px 12px;gap:10px}#ucaa-maintenance .tool{width:42px;height:42px;flex-basis:42px;border-radius:10px}#ucaa-maintenance .tool svg{width:26px;height:26px}#ucaa-maintenance h1{font-size:20px}#ucaa-maintenance .content{padding:28px 16px 30px}#ucaa-maintenance .message{font-size:15px}#ucaa-maintenance .countdown{margin-top:22px}#ucaa-maintenance .backup{width:100%;font-size:13px}}
@media(prefers-reduced-motion:reduce){#ucaa-maintenance .spinner{animation-duration:1.8s}}
`;document.head.append(styles);
const el=document.createElement('section');el.id='ucaa-maintenance';
el.innerHTML=`<main class="page" aria-labelledby="ucaa-maintenance-title"><div class="bar"><span class="tool" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#176b7d" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z"/></svg></span><h1 id="ucaa-maintenance-title">Технічні роботи</h1></div><div class="content"><p class="message">Вас буде автоматично перенаправлено на резервну сторінку.</p><div class="countdown" role="timer" aria-label="Час до перенаправлення"><span class="spinner" aria-hidden="true"></span><span class="countdown-text">Перенаправлення через <strong class="seconds" id="ucaa-maintenance-seconds">5</strong> с</span></div><a class="backup" id="ucaa-maintenance-backup" href="https://kazuar-avia.github.io/pilot-cabinet.html">Перейти до резервного кабінету <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a></div></main>`;
document.body.append(el);document.title='Технічні роботи — Кабінет пілота';
const target=()=>BACKUP+location.hash;const link=el.querySelector('#ucaa-maintenance-backup');const updateLink=()=>link.href=target();updateLink();window.addEventListener('hashchange',updateLink);reveal();
const seconds=el.querySelector('#ucaa-maintenance-seconds');const end=performance.now()+5000;const timer=setInterval(()=>{const ms=Math.max(0,end-performance.now());seconds.textContent=String(Math.ceil(ms/1000));if(ms===0){clearInterval(timer);location.replace(target());}},100);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',draw,{once:true});else draw();
}
async function check(){
if(checking||active)return;checking=true;const c=new AbortController();const t=setTimeout(()=>c.abort(),3000);
try{const response=await fetch(URL+'?t='+Date.now(),{cache:'no-store',signal:c.signal});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(data&&data.enabled===true)maintenance();else reveal();}
catch(err){console.warn('[UCAA] Maintenance status unavailable; opening ordinary cabinet',err);reveal();}
finally{clearTimeout(t);checking=false;}
}
void check();setInterval(check,30000);
})();