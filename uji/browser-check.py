# Run with browser-use; set DRIVEGUTOK_FIXTURE to the sandbox session.json path.
# All data, accounts, uploads belong to browser-fixture.mjs only.
import json
import os
import time
from pathlib import Path

js, cdp, new_tab, goto_url, wait_for_load, fill_input, capture_screenshot = (
    globals()[name] for name in ['js', 'cdp', 'new_tab', 'goto_url', 'wait_for_load', 'fill_input', 'capture_screenshot']
)
s = json.loads(Path(os.environ['DRIVEGUTOK_FIXTURE']).read_text())
assert s['base'].startswith('http://127.0.0.1:'), 'Only the local fixture is permitted'
output = Path(os.environ['BH_AGENT_WORKSPACE']) / 'drivegutok-browser-results.json'
results = []

def wait(expression):
    for _ in range(100):
        if js(expression):
            return True
        time.sleep(0.1)
    return False

def check(name, condition):
    results.append({'name': name, 'passed': bool(condition)})
    output.write_text(json.dumps(results, indent=2))
    print(('PASS ' if condition else 'FAIL ') + name)
    assert condition, name

def click(selector):
    js(f'document.querySelector({json.dumps(selector)}).click()')

def session(role):
    name, value = s[role + 'Cookie'].split('=', 1)
    cdp('Network.setCookie', name=name, value=value, url=s['base'], httpOnly=True, sameSite='Lax')
    goto_url(s['base'])
    wait_for_load()
    check(role + ' dashboard', wait("!!document.querySelector('#upload-trigger')"))

def upload(filename, cdn=False):
    click('#cdn-trigger' if cdn else '#upload-trigger')
    root = cdp('DOM.getDocument')['root']['nodeId']
    node = cdp('DOM.querySelector', nodeId=root, selector='#modal-file-input')['nodeId']
    cdp('DOM.setFileInputFiles', nodeId=node, files=[s['fixtures'] + '/' + filename])
    js("document.querySelector('#upload-form').requestSubmit()")
    check('upload ' + filename, wait(f"[...document.querySelectorAll('.file-card:not(.is-uploading):not(.is-selesai) .file-name')].some(e=>e.textContent.includes({json.dumps(filename)}))"))

new_tab(s['base'])
cdp('Page.addScriptToEvaluateOnNewDocument', source="window.__qaErrors=[];addEventListener('error',e=>__qaErrors.push(e.message));addEventListener('unhandledrejection',e=>__qaErrors.push(String(e.reason)));window.confirm=()=>true;window.prompt=(m,d)=>/Nama baru/.test(m)?'Catatan diganti.txt':/Password opsional/.test(m)?'':/Berapa hari/.test(m)?'1':d;")
cdp('Emulation.setDeviceMetricsOverride', width=1280, height=900, deviceScaleFactor=1, mobile=False)
session('owner')
check('owner controls', js("!!document.querySelector('#admin-view') && !!document.querySelector('#upload-provider')"))
check('empty workspace', js("document.querySelectorAll('.file-card').length===0"))
click('#folder-trigger')
fill_input('#modal-form input[name="name"]', 'Dokumen uji')
js("document.querySelector('#modal-form').requestSubmit()")
check('create folder', wait("document.querySelector('.folder .file-name')?.textContent==='Dokumen uji'"))
click('#tab-cdn')
check('CDN heading', js("document.querySelector('.panel-heading h2').textContent==='Berkas CDN'"))
check('CDN aria-selected', js("document.querySelector('#tab-cdn').getAttribute('aria-selected')==='true' && document.querySelector('#tab-file').getAttribute('aria-selected')==='false'"))
check('CDN folder hidden', js("document.querySelector('.folder').getBoundingClientRect().height===0"))
click('#tab-file')
click('[data-open-folder]')
check('open folder', wait("document.querySelector('.view-title')?.textContent==='Dokumen uji'"))
click('[data-folder=""]')
check('root breadcrumb', wait("document.querySelector('.view-title')?.textContent==='Penyimpanan'"))
upload('catatan.txt')
upload('pixel.png', True)
check('automatic uploads bypass invalid Google', js("(async()=>{const d=await(await fetch('/api/dashboard')).json();return d.files.length===2 && d.files.every(f=>f.provider===" + json.dumps(s['providerId']) + ")})()"))
click('#tab-file')
file = '.file-card:not(.folder):not(.is-cdn)'
click(file + ' .file-view')
check('text preview iframe', wait("!!document.querySelector('#media-modal iframe')"))
check('preview bytes', js("(async()=>{const q=await fetch(document.querySelector('#media-modal iframe').src);return q.ok && (await q.text()).includes('Berkas uji lokal')})()"))
click('#close-media')
click(file + ' .file-rename')
check('rename file', wait("document.querySelector('.file-card:not(.folder):not(.is-cdn) .file-name')?.textContent==='Catatan diganti.txt'"))
click(file + ' .file-share')
check('share dialog', wait("!!document.querySelector('#share-link')"))
check('shared URL returns bytes', js("(async()=>{const q=await fetch(document.querySelector('#share-link').value,{credentials:'omit'});return q.ok && (await q.text()).includes('Berkas uji lokal')})()"))
click('#close-share')
click('#tab-cdn')
click('.is-cdn .file-cdn')
check('CDN public image', js("(async()=>{const q=await fetch(document.querySelector('#cdn-link').value,{credentials:'omit'});return q.ok && q.headers.get('content-type').startsWith('image/png') && (await q.arrayBuffer()).byteLength>0})()"))
click('#toggle-cdn')
check('CDN disable', wait("!document.querySelector('.is-cdn')"))
click('#tab-file')
image = ".file-card:has(.file-name[title='pixel.png'])"
click(image + ' .file-cdn')
click('#toggle-cdn')
check('CDN enable', wait("!!document.querySelector('.is-cdn')"))
click('#tab-file')
click(file + ' .file-move')
check('move dialog', wait("!!document.querySelector('#move-target option:not([value=\"\"])')"))
js("const t=document.querySelector('#move-target');t.value=t.options[1].value;document.querySelector('#move-form').requestSubmit()")
check('file moved from root', wait("!document.querySelector('.file-card:not(.folder):not(.is-cdn)')"))
click('[data-open-folder]')
check('destination folder loaded', wait("document.querySelector('.view-title')?.textContent==='Dokumen uji'"))
check('file in destination', js("document.querySelector('.file-card:not(.folder) .file-name')?.textContent==='Catatan diganti.txt'"))
click('.file-delete')
check('soft delete', wait("!document.querySelector('.file-card:not(.folder)')"))
click('#trash-view')
check('trash contains selected file', wait("document.querySelector('.trash-row .file-name')?.textContent==='Catatan diganti.txt'"))
click('.trash-restore')
check('restore removes from trash', wait("!document.querySelector('.trash-restore')"))
click('#trash-back')
check('root after trash', wait("document.querySelector('.view-title')?.textContent==='Penyimpanan'"))
click('[data-open-folder]')
check('restored file in original folder', wait("document.querySelector('.view-title')?.textContent==='Dokumen uji' && document.querySelector('.file-card .file-name')?.textContent==='Catatan diganti.txt'"))
click('.file-delete')
check('delete again', wait("!document.querySelector('.file-card')"))
click('#trash-view')
check('trash second visit', wait("!!document.querySelector('.trash-purge')"))
click('.trash-purge')
check('permanent delete', wait("!document.querySelector('.trash-purge')"))
click('#trash-back')
wait("!!document.querySelector('#admin-view')")
click('#admin-view')
check('admin overview', wait("!!document.querySelector('.provider-list') && !!document.querySelector('.member-list')"))
check('admin upload controls absent', js("!document.querySelector('#cdn-trigger') && !document.querySelector('#upload-trigger')"))
click('#back-dashboard')
check('dashboard after admin', wait("!!document.querySelector('.user-menu')"))
click('.user-menu')
check('account forms', wait("!!document.querySelector('#form-akun-email') && !!document.querySelector('#form-akun-sandi')"))
check('account required fields', js("!document.querySelector('#form-akun-email').checkValidity() && !document.querySelector('#form-akun-sandi').checkValidity()"))
check('no runtime errors desktop', js('window.__qaErrors.length===0'))
session('owner')
click('#tab-cdn')
for width in [320, 390, 768, 1440]:
    cdp('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=width<768)
    check(f'dashboard width {width}', js('document.documentElement.scrollWidth<=innerWidth'))
    if width == 390:
        check('mobile actions 44px', js("[...document.querySelectorAll('.is-cdn .card-actions button')].every(e=>{const r=e.getBoundingClientRect();return r.width>=44 && r.height>=44})"))
        click('#drawer-toggle')
        check('drawer open', js("document.querySelector('#drawer-toggle').getAttribute('aria-expanded')==='true'"))
        click('#drawer-scrim')
        check('drawer closes', js("document.querySelector('#drawer-toggle').getAttribute('aria-expanded')==='false'"))
        capture_screenshot()
check('no runtime errors mobile', js('window.__qaErrors.length===0'))
capture_screenshot()
session('member')
check('member owner controls absent', js("!document.querySelector('#admin-view') && !document.querySelector('#upload-provider')"))
check('owner API forbidden', js("(async()=> (await fetch('/api/admin/overview')).status===403)()"))
check('member data isolated', js("(async()=>{const d=await(await fetch('/api/dashboard')).json();return d.files.length===0 && d.folders.length===0})()"))
click('#logout')
check('logout login screen', wait("!!document.querySelector('#login-form')"))
check('session invalid after logout', js("(async()=> (await fetch('/api/me')).status===401)()"))
check('empty login blocked', js("!document.querySelector('#login-form').checkValidity()"))
check('setup not exposed after owner created', js("!document.querySelector('#setup-owner')"))
for width in [320, 390, 768, 1440]:
    cdp('Emulation.setDeviceMetricsOverride', width=width, height=900, deviceScaleFactor=1, mobile=width<768)
    check(f'login width {width}', js('document.documentElement.scrollWidth<=innerWidth'))
check('no runtime errors end', js('window.__qaErrors.length===0'))
print(json.dumps({'checks': len(results), 'passed': sum(row['passed'] for row in results), 'report': str(output)}))
