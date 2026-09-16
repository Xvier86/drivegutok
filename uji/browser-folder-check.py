# Run through browser_exec; DRIVEGUTOK_FIXTURE points to a fresh browser-fixture.mjs session.json.
import hashlib
import json
import os
import time
from pathlib import Path
js, cdp, new_tab, goto_url, wait_for_load = (globals()[n] for n in ['js', 'cdp', 'new_tab', 'goto_url', 'wait_for_load'])
s = json.loads(Path(os.environ['DRIVEGUTOK_FIXTURE']).read_text())
assert s['base'].startswith('http://127.0.0.1:'), 'Sandbox only'
report = Path(os.environ['BH_AGENT_WORKSPACE']) / 'drivegutok-folder-results.json'
rows = []
def check(name, ok):
    rows.append({'name': name, 'passed': bool(ok)})
    report.write_text(json.dumps(rows, indent=2))
    print(('PASS ' if ok else 'FAIL ') + name)
    assert ok, name
def wait(expr):
    for _ in range(150):
        if js(expr): return True
        time.sleep(.2)
    return False
new_tab(s['base']); wait_for_load()
cdp('Page.bringToFront')
cdp('Emulation.setFocusEmulationEnabled', enabled=True)
key, value = s['ownerCookie'].split('=', 1)
cdp('Network.setCookie', name=key, value=value, url=s['base'], httpOnly=True, sameSite='Lax')
goto_url(s['base']); wait_for_load()
check('owner dashboard', wait("!!document.querySelector('#upload-trigger')"))
js("window.__folderErrors=[];addEventListener('error',e=>__folderErrors.push(e.message));addEventListener('unhandledrejection',e=>__folderErrors.push(String(e.reason)))")
dest = js("(async()=>{const r=await fetch('/api/folders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Tujuan folder QA',parentId:null})});if(!r.ok)throw Error('fixture destination');return (await r.json()).id})()")
js("(async()=>{const {state}=await import('/js/state.js');const {ke}=await import('/js/router.js');state.folderId="+json.dumps(dest)+";await ke('dashboard')})()")
check('destination opened', wait("document.querySelector('.view-title')?.textContent==='Tujuan folder QA'"))
fixture = Path(s['fixtures']) / 'Paket QA'
contents = {'root.txt': b'Root folder upload\n', 'sub/identik.txt': b'First duplicate basename\n', 'sub/dalam/identik.txt': b'Second duplicate basename\n', 'sub/empty.txt': b''}
for rel, content in contents.items():
    p = fixture / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
check('folder upload control', js("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Upload folder')"))
js("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Upload folder').click()")
check('native directory picker', wait("!!document.querySelector('#upload-modal:modal input[webkitdirectory]')"))
node = cdp('DOM.querySelector', nodeId=cdp('DOM.getDocument')['root']['nodeId'], selector='#upload-modal input[webkitdirectory]')['nodeId']
cdp('DOM.setFileInputFiles', nodeId=node, files=[str(fixture)])
paths = js("[...document.querySelector('#upload-modal input[webkitdirectory]').files].map(f=>f.webkitRelativePath)")
check('native relative paths retained', set(paths)=={'Paket QA/'+x for x in contents})
for width in [320,390,1440]:
    cdp('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=width<768)
    check('folder picker width '+str(width), js('document.documentElement.scrollWidth<=innerWidth'))
js("document.querySelector('#upload-form').requestSubmit()")
check('uploaded tree visible', wait("!document.querySelector('#upload-modal') && [...document.querySelectorAll('.folder .file-name')].some(e=>e.textContent==='Paket QA')"))
folders = js("(async()=>{const r=await fetch('/api/folders');return (await r.json()).folders})()")
parent = dest
folder_ids = {}
for name, path in [('Paket QA',''),('sub','sub'),('dalam','sub/dalam')]:
    found = [f for f in folders if f['name']==name and f['parent_id']==parent]
    check('one folder '+(path or 'root'),len(found)==1)
    parent = found[0]['id']; folder_ids[path]=parent
actual = {}
for path, folder_id in folder_ids.items():
    files = js("(async()=>{const r=await fetch('/api/dashboard?folderId='+"+json.dumps(folder_id)+");return (await r.json()).files})()")
    for f in files:
        rel = (path+'/' if path else '')+f['name']
        check('expected path '+rel,rel in contents)
        result = js("(async()=>{const r=await fetch('/api/files/'+"+json.dumps(f['id'])+"+'/download');const b=await r.arrayBuffer();return {status:r.status,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')}})()")
        check('exact bytes '+rel,result['status']==200 and result['hash']==hashlib.sha256(contents[rel]).hexdigest())
        check('selected provider '+rel,f['provider']==s['providerId'])
        actual[rel]=f['id']
check('all selected files uploaded once',set(actual)==set(contents) and len(set(actual.values()))==len(contents))
check('destination remains selected',js("document.querySelector('.view-title')?.textContent==='Tujuan folder QA'"))
# Native filesystem drag, including an empty directory and a loose file.
drop = Path(s['fixtures']) / 'Drop QA'
(drop / 'nested').mkdir(parents=True, exist_ok=True)
(drop / 'kosong').mkdir(exist_ok=True)
(drop / 'nested' / 'drop.txt').write_text('Native dropped folder\n')
loose = Path(s['fixtures']) / 'loose.txt'
loose.write_text('Native loose file\n')
cdp('Emulation.setDeviceMetricsOverride', width=1440, height=900, deviceScaleFactor=1, mobile=False)
js("document.querySelector('#dropzone').scrollIntoView({block:'center'})")
box = js("(()=>{const r=document.querySelector('#dropzone').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
for kind in ['dragEnter', 'dragOver', 'drop']:
    cdp('Input.dispatchDragEvent', type=kind, x=box['x'], y=box['y'], data={'items':[], 'files':[str(drop),str(loose)], 'dragOperationsMask':1})
check('native mixed drop paths',wait("document.querySelector('#upload-selection')?.textContent.includes('Drop QA/nested/drop.txt') && document.querySelector('#upload-selection').textContent.includes('loose.txt')"))
check('empty directory limitation visible',js("document.querySelector('#upload-modal').textContent.includes('Folder kosong tidak ikut diunggah')"))
js("document.querySelector('#upload-form').requestSubmit()")
check('dropped tree uploaded',wait("!document.querySelector('#upload-modal') && [...document.querySelectorAll('.folder .file-name')].some(e=>e.textContent==='Drop QA')"))
folders = js("(async()=>{const r=await fetch('/api/folders');return (await r.json()).folders})()")
root = next(f for f in folders if f['name']=='Drop QA' and f['parent_id']==dest)
nested = next(f for f in folders if f['name']=='nested' and f['parent_id']==root['id'])
for folder_id, name, text in [(nested['id'],'drop.txt','Native dropped folder\n'),(dest,'loose.txt','Native loose file\n')]:
    result = js("(async()=>{const d=await(await fetch('/api/dashboard?folderId='+"+json.dumps(folder_id)+")).json();const f=d.files.find(f=>f.name==="+json.dumps(name)+");if(!f)return null;return await(await fetch('/api/files/'+f.id+'/download')).text()})()")
    check('native drop bytes '+name,result==text)
# Existing flat uploads retain duplicate basenames and whitespace.
js("(async()=>{const {uploadFiles}=await import('/js/views/files.js');await uploadFiles([new File(['spaced'],' report.txt'),new File(['first'],'same.txt'),new File(['second'],'same.txt')])})()")
flat = js("(async()=>{const d=await(await fetch('/api/dashboard?folderId='+"+json.dumps(dest)+")).json();const out=[];for(const f of d.files.filter(f=>[' report.txt','same.txt'].includes(f.name))){out.push({name:f.name,text:await(await fetch('/api/files/'+f.id+'/download')).text()})}return out})()")
check('flat whitespace and duplicate basenames preserved',sorted((x['name'],x['text']) for x in flat)==[(' report.txt','spaced'),('same.txt','first'),('same.txt','second')])
# Delay directory reading, navigate, then submit through the actual modal.
js("document.querySelector('#upload-provider').value="+json.dumps(s['providerId']))
js("""(()=>{
    window.__releaseFolderRead=null;
    const entry={name:'Delayed QA',isDirectory:true,createReader(){let done=false;return {readEntries(resolve){if(done)return resolve([]);done=true;resolve([{name:'delayed.txt',isFile:true,file(resolve){window.__releaseFolderRead=()=>resolve(new File(['Pinned drop bytes'],'delayed.txt'))}}])}}}};
    const target=document.querySelector('#dropzone');
    window.__pendingFolderDrop=target.ondrop({preventDefault(){},currentTarget:target,dataTransfer:{items:[{kind:'file',webkitGetAsEntry:()=>entry}]}});
    return true;
})()""")
check('delayed traversal started',wait('!!window.__releaseFolderRead'))
other = js("(async()=>{const r=await fetch('/api/folders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Other destination',parentId:null})});return (await r.json()).id})()")
js("(async()=>{const {state}=await import('/js/state.js');const {ke}=await import('/js/router.js');state.folderId="+json.dumps(other)+";await ke('dashboard');document.querySelector('#upload-provider').value=state.dashboard.providers.find(p=>p.id!=="+json.dumps(s['providerId'])+").id;window.__releaseFolderRead();await window.__pendingFolderDrop})()")
check('delayed modal ready',wait("!!document.querySelector('#upload-modal:modal')"))
js("document.querySelector('#upload-form').requestSubmit()")
check('delayed file uploaded',wait("(async()=>{const d=await(await fetch('/api/folders')).json();const f=d.folders.find(f=>f.name==='Delayed QA'&&f.parent_id==="+json.dumps(dest)+");if(!f)return false;const a=await(await fetch('/api/dashboard?folderId='+f.id)).json();return a.files.some(f=>f.name==='delayed.txt')})()"))
pinned = js("(async()=>{const d=await(await fetch('/api/folders')).json();const f=d.folders.find(f=>f.name==='Delayed QA'&&f.parent_id==="+json.dumps(dest)+");const a=await(await fetch('/api/dashboard?folderId='+f.id)).json();return {provider:a.files[0].provider,text:await(await fetch('/api/files/'+a.files[0].id+'/download')).text(),wrong:d.folders.some(f=>f.name==='Delayed QA'&&f.parent_id==="+json.dumps(other)+")}})()")
check('drop destination and provider pinned before scan',pinned=={'provider':s['providerId'],'text':'Pinned drop bytes','wrong':False})
check('no runtime errors',js('window.__folderErrors.length===0'))
print(json.dumps({'checks':len(rows),'passed':sum(r['passed'] for r in rows),'report':str(report)}))
