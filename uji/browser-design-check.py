# Run through browser_exec with DRIVEGUTOK_FIXTURE after browser-check.py.
import base64
import json
import subprocess
import os
import time
from pathlib import Path
js, cdp, new_tab, wait_for_load, fill_input = (globals()[name] for name in ['js', 'cdp', 'new_tab', 'wait_for_load', 'fill_input'])
s = json.loads(Path(os.environ['DRIVEGUTOK_FIXTURE']).read_text())
assert s['base'].startswith('http://127.0.0.1:')
assert js('location.origin') == s['base'], 'Run browser-check.py on this fixture first'
Path(s['fixtures'], 'preview.pdf').write_bytes(base64.b64decode(cdp('Page.printToPDF', printBackground=True)['data']))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gold:s=160x90:d=1', '-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-y', str(Path(s['fixtures'], 'preview.webm'))], check=True)
report = Path(os.environ['BH_AGENT_WORKSPACE']) / 'drivegutok-design-extra-results.json'
rows = []
def check(name, ok):
    rows.append({'name': name, 'passed': bool(ok)})
    report.write_text(json.dumps(rows, indent=2))
    print(('PASS ' if ok else 'FAIL ') + name)
    assert ok, name
def wait(expr):
    for _ in range(100):
        if js(expr): return True
        time.sleep(.1)
    return False
def click(selector): js('document.querySelector(' + json.dumps(selector) + ').click()')
def key(name):
    cdp('Input.dispatchKeyEvent', type='keyDown', key=name, code=name, windowsVirtualKeyCode={'Escape':27,'Tab':9}[name])
    cdp('Input.dispatchKeyEvent', type='keyUp', key=name, code=name, windowsVirtualKeyCode={'Escape':27,'Tab':9}[name])
def fit(label):
    for width in [320,390,768,1440]:
        cdp('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=width<768)
        check(label + ' width ' + str(width), js('document.documentElement.scrollWidth<=innerWidth'))
def upload(name):
    click('#upload-trigger')
    node=cdp('DOM.querySelector',nodeId=cdp('DOM.getDocument')['root']['nodeId'],selector='#modal-file-input')['nodeId']
    cdp('DOM.setFileInputFiles',nodeId=node,files=[s['fixtures']+'/'+name])
    js("document.querySelector('#upload-form').requestSubmit()")
    check('upload '+name,wait("[...document.querySelectorAll('.file-card:not(.is-uploading):not(.is-selesai) .file-name')].some(e=>e.getAttribute('title')==="+json.dumps(name)+")"))
name,value=s['ownerCookie'].split('=',1)
cdp('Network.setCookie',name=name,value=value,url=s['base'],httpOnly=True,sameSite='Lax')
new_tab(s['base']); wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setFocusEmulationEnabled', enabled=True)
check('owner ready',wait("!!document.querySelector('#upload-trigger')"))
js("window.__designErrors=[];addEventListener('error',e=>__designErrors.push(e.message));addEventListener('unhandledrejection',e=>__designErrors.push(String(e.reason)));window.confirm=()=>true")
cdp('Emulation.setDeviceMetricsOverride',width=1440,height=900,deviceScaleFactor=1,mobile=False)
js("document.querySelector('#upload-trigger').focus()")
click('#upload-trigger')
check('upload dialog focus',js("document.querySelector('#upload-modal:modal').contains(document.activeElement)"))
for _ in range(9): key('Tab')
check('dialog contains keyboard focus',js("document.querySelector('#upload-modal').contains(document.activeElement)"))
key('Escape')
check('escape restores upload focus',js("!document.querySelector('#upload-modal') && document.activeElement.id==='upload-trigger'"))
drop_file = Path(s['fixtures'], 'drop-check.txt')
drop_file.write_text('Dropped design fixture')
js("document.querySelector('#dropzone').scrollIntoView({block:'center'})")
box = js("(()=>{const r=document.querySelector('#dropzone').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
for kind in ['dragEnter', 'dragOver', 'drop']:
    cdp('Input.dispatchDragEvent', type=kind, x=box['x'], y=box['y'], data={'items':[], 'files':[str(drop_file)], 'dragOperationsMask':1})
check('drop opens selection',wait("document.querySelector('#upload-selection')?.textContent.includes('drop-check.txt')"))
js("document.querySelector('#upload-form').requestSubmit()")
check('dropped file uploaded',wait("[...document.querySelectorAll('.file-card:not(.is-uploading):not(.is-selesai) .file-name')].some(e=>e.textContent==='drop-check.txt')"))
click('[data-open-folder]')
check('parent opened',wait("document.querySelector('.view-title')?.textContent==='Dokumen uji'"))
click('#folder-trigger');fill_input('#modal-form input[name="name"]','Nested design')
js("document.querySelector('#modal-form').requestSubmit()")
check('nested folder created',wait("document.querySelector('.folder .file-name')?.textContent==='Nested design'"))
click('.folder-rename');fill_input('#rename-name','Nested renamed')
js("document.querySelector('#rename-form').requestSubmit()")
check('nested rename',wait("document.querySelector('.folder .file-name')?.textContent==='Nested renamed'"))
click('.folder-move')
check('folder move excludes self',wait("!!document.querySelector('#move-target')") and js("![...document.querySelector('#move-target').options].some(o=>o.textContent.includes('Nested renamed'))"))
js("document.querySelector('#move-target').value='';document.querySelector('#move-form').requestSubmit()")
check('nested moved away',wait("!document.querySelector('.folder')"))
click('[data-folder=""]');check('root contains moved folder',wait("[...document.querySelectorAll('.folder .file-name')].some(e=>e.textContent==='Nested renamed')"))
js("[...document.querySelectorAll('.folder')].find(e=>e.querySelector('.file-name').textContent==='Nested renamed').querySelector('.folder-delete').click()")
check('folder soft delete',wait("![...document.querySelectorAll('.folder .file-name')].some(e=>e.textContent==='Nested renamed')"))
click('#trash-view');check('folder in trash',wait("!!document.querySelector('.trash-restore[data-kind=folder]')"))
click('.trash-restore[data-kind=folder]');check('folder restored',wait("!document.querySelector('.trash-restore[data-kind=folder]')"))
click('#trash-back');check('dashboard back',wait("!!document.querySelector('#upload-trigger')"))
for filename in ['preview.webm','preview.pdf']:
    upload(filename)
    js("[...document.querySelectorAll('.file-card')].find(e=>e.querySelector('.file-name')?.getAttribute('title')==="+json.dumps(filename)+").querySelector('.file-view').click()")
    check(filename+' native preview',wait("!!document.querySelector('#media-modal:modal')"))
    if filename.endswith('webm'):
        js("document.querySelector('#media-modal video').muted=true;document.querySelector('#media-modal video').play().catch(e=>window.__designErrors.push(e.message))")
        check('video metadata decoded',wait("document.querySelector('#media-modal video')?.readyState>=1"))
        check('video plays',wait("document.querySelector('#media-modal video').currentTime>0"))
    else:
        check('PDF response inline',js("(async()=>{const r=await fetch(document.querySelector('#media-modal iframe').src);return r.ok&&r.headers.get('content-type').includes('pdf')&&!r.headers.get('content-disposition')?.startsWith('attachment')&&(await r.text()).startsWith('%PDF')})()"))
    fit(filename+' modal')
    check(filename+' modal within viewport',js("(()=>{const r=document.querySelector('#media-modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"))
    click('#close-media')
click('#tab-cdn');click('.is-cdn:has(.file-name[title="pixel.png"]) .file-view')
check('image pixels decoded',wait("document.querySelector('#media-modal img')?.naturalWidth>0"))
click('#close-media')
click('#admin-view');check('admin ready',wait("!!document.querySelector('.provider-list')"))
fit('admin')
selector='.provider-toggle[data-provider="'+s['providerId']+'"]'
click(selector);check('provider disabled',wait('document.querySelector('+json.dumps(selector)+')?.dataset.enabled==="0"'))
check('provider disabled persisted',js("(async()=>{const d=await(await fetch('/api/admin/overview')).json();return !d.providers.find(p=>p.id==="+json.dumps(s['providerId'])+").enabled})()"))
click(selector);check('provider reenabled',wait('document.querySelector('+json.dumps(selector)+')?.dataset.enabled==="1"'))
click('.provider-config[data-kind="gdrive"]')
check('Google config dialog',wait("!!document.querySelector('#modal:modal #gdrive-auth')"))
js("const e=document.querySelector('#gdrive-auth');e.value='oauth';e.dispatchEvent(new Event('change'))")
check('OAuth fields selected',js("document.querySelector('#gdrive-service').hidden&&!document.querySelector('#gdrive-oauth').hidden&&[...document.querySelectorAll('#gdrive-service input,#gdrive-service textarea')].every(e=>e.disabled)"))
fit('Google config');click('#close-modal')
click('#invite-user');check('invite validation retained',js("!!document.querySelector('#modal:modal')&&!document.querySelector('#modal-form').checkValidity()&&document.querySelector('input[name=password]').minLength===8"));fit('invite');click('#close-modal')
click('.member-access');check('member suspended',wait("document.querySelector('.member-access')?.dataset.status==='suspended'"))
click('.member-access');check('member restored',wait("document.querySelector('.member-access')?.dataset.status==='active'"))
click('.user-menu');check('account ready',wait("!!document.querySelector('#form-akun-email')"));fit('account')
cdp('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'reduce'}])
check('reduced motion applied',js("parseFloat(getComputedStyle(document.querySelector('.main')).animationDuration)<=.001"))
cdp('Emulation.setEmulatedMedia',features=[])
# Review regressions: use actual CSS visibility and clipboard selection.
cdp('Emulation.setDeviceMetricsOverride',width=700,height=900,deviceScaleFactor=1,mobile=False)
click('#drawer-toggle')
check('drawer opens at 700',js("document.body.classList.contains('is-drawer')"))
cdp('Emulation.setDeviceMetricsOverride',width=740,height=900,deviceScaleFactor=1,mobile=False)
check('drawer reset at 740',wait("!document.body.classList.contains('is-drawer') && getComputedStyle(document.body).overflow!=='hidden' && document.querySelector('#drawer-toggle').getAttribute('aria-expanded')==='false'"))
cdp('Emulation.setDeviceMetricsOverride',width=700,height=900,deviceScaleFactor=1,mobile=False)
check('drawer stays closed after shrink',js("!document.body.classList.contains('is-drawer')"))
# Denied Clipboard API must select the requested text inside the active native dialog.
clip=js("""(async()=>{const {shareFile,copyText}=await import('/js/views/files.js');const {closeDialog}=await import('/js/core.js');shareFile('review-fixture-a','REVIEW A','');const original=Object.getOwnPropertyDescriptor(navigator,'clipboard'),native=document.execCommand;let selected='',inside=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('fixture denied')}}});document.execCommand=function(c){const e=document.activeElement;selected=e?.value?.slice(e.selectionStart,e.selectionEnd)||'';inside=!!e?.closest('dialog:modal');return native.call(document,c)};try{await copyText('expected-copy-value');return {selected,inside}}finally{document.execCommand=native;if(original)Object.defineProperty(navigator,'clipboard',original);else delete navigator.clipboard;closeDialog('share-modal')}})()""")
check('clipboard fallback selects correct text in dialog',clip['selected']=='expected-copy-value' and clip['inside'])
# Mock only these nonexistent IDs: no share is created on the server.
for outcome in ['success','failure']:
    same=js("""(async()=>{const {shareFile}=await import('/js/views/files.js');const {closeDialog}=await import('/js/core.js');const native=window.fetch;let resolve;window.fetch=(url,o)=>url==='/api/files/review-fixture-a/share'?new Promise(r=>{resolve=r}):native(url,o);try{shareFile('review-fixture-a','REVIEW A','');document.querySelector('#share-form').requestSubmit();closeDialog('share-modal');shareFile('review-fixture-b','REVIEW B','');const b=document.querySelector('#share-modal');resolve(new Response(JSON.stringify(%s),{status:%s,headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,100));return document.querySelector('#share-modal')===b&&!b.querySelector('#share-error').textContent&&b.querySelector('.dialog-context').textContent.includes('REVIEW B')}finally{window.fetch=native;closeDialog('share-modal')}})()"""%(json.dumps({'url':'/fixture-share-a','expiresAt':None} if outcome=='success' else {'error':'fixture rejected'}),'200' if outcome=='success' else '500'))
    check('stale share '+outcome+' preserves new dialog',same)
check('extended runtime clean',js('window.__designErrors.length===0'))
print(json.dumps({'checks':len(rows),'passed':sum(r['passed'] for r in rows),'report':str(report)}))
