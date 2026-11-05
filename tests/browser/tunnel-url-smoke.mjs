import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const root = path.resolve(process.env.MOARTUBE_TUNNEL_SMOKE_DIR ?? 'temp/url-audit');
fs.mkdirSync(root, { recursive: true });
const fixture = fs.mkdtempSync(path.join(root, 'fixture-'));
const name = 'moartube-url-audit-' + randomBytes(4).toString('hex');
const id = 'UrlTest0001';
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  }).trim();
const ffmpeg = process.env.MOARTUBE_FFMPEG;
assert.ok(ffmpeg, 'Set MOARTUBE_FFMPEG');
execFileSync(
  ffmpeg,
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x180:rate=24',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '24',
    '-f',
    'hls',
    '-hls_time',
    '1',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    path.join(fixture, 'segment-360p-%d.ts'),
    '-hls_base_url',
    `http://localhost:9090/external/videos/${id}/adaptive/m3u8/360p/segments/`,
    path.join(fixture, 'manifest-360p.m3u8'),
  ],
  { windowsHide: true }
);
fs.writeFileSync(
  path.join(fixture, 'manifest-master.m3u8'),
  `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=320x180\nhttp://localhost:9090/external/videos/${id}/adaptive/m3u8/static/manifests/manifest-360p.m3u8\n`
);
execFileSync(
  ffmpeg,
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180',
    '-frames:v',
    '1',
    path.join(fixture, 'image.jpg'),
  ],
  { windowsHide: true }
);
fs.writeFileSync(
  path.join(fixture, 'bootstrap.mjs'),
  `
import fs from 'node:fs';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
const require=createRequire('/moartube-node/package.json');const bcrypt=require('bcryptjs');const DB=require('better-sqlite3');
if(!fs.existsSync('/data/_node_settings.json')){const credentials={username:'audit-'+randomBytes(4).toString('hex'),password:randomBytes(24).toString('hex')};fs.writeFileSync('/data/_smoke_credentials',JSON.stringify(credentials),{mode:0o600});fs.writeFileSync('/data/_node_settings.json',JSON.stringify({nodeListeningPort:9090,username:Buffer.from(bcrypt.hashSync(credentials.username,4)).toString('base64'),password:Buffer.from(bcrypt.hashSync(credentials.password,4)).toString('base64'),databaseConfig:{databaseDialect:'sqlite'},storageConfig:{storageMode:'filesystem'},publicNodeProtocol:'http',publicNodeAddress:'localhost',publicNodePort:9090}));}
const directory='/data/media/videos/${id}/adaptive/m3u8';fs.mkdirSync(directory+'/360p',{recursive:true});fs.mkdirSync('/data/images',{recursive:true});
for(const file of fs.readdirSync('/tmp/fixture')){if(file.endsWith('.m3u8'))fs.copyFileSync('/tmp/fixture/'+file,directory+'/'+file);if(file.endsWith('.ts'))fs.copyFileSync('/tmp/fixture/'+file,directory+'/360p/'+file);}
fs.mkdirSync('/data/media/videos/${id}/images',{recursive:true});for(const kind of ['poster','preview','thumbnail'])fs.copyFileSync('/tmp/fixture/image.jpg','/data/media/videos/${id}/images/'+kind+'.jpg');
const child=spawn(process.execPath,['dist/moartube-node.js'],{stdio:'inherit'});
const seed=setInterval(()=>{let db;try{db=new DB('/data/db/node_db.sqlite');db.prepare('INSERT INTO videos(video_id,title,description,tags,length_seconds,is_published,outputs,creation_timestamp) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM videos WHERE video_id=?)').run('${id}','URL audit','Synthetic audit video','audit',4,1,JSON.stringify({m3u8:['360p'],mp4:[],webm:[],ogv:[]} ),Date.now(),'${id}');clearInterval(seed);}catch{}finally{db?.close();}},200);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{clearInterval(seed);process.exitCode=code??1;});
`
);
const exec = (code) => docker('exec', name, 'node', '--input-type=module', '-e', code);
const settings = () =>
  JSON.parse(
    exec(
      "import fs from 'node:fs';const {cloudflareTunnelName,isCloudflareTunnelEnabled}=JSON.parse(fs.readFileSync('/data/_node_settings.json','utf8'));process.stdout.write(JSON.stringify({cloudflareTunnelName,isCloudflareTunnelEnabled}));"
    )
  );
const storedHash = () =>
  exec(
    `import fs from 'node:fs';import{createHash}from'node:crypto';process.stdout.write(createHash('sha256').update(fs.readFileSync('/data/media/videos/${id}/adaptive/m3u8/manifest-360p.m3u8')).digest('hex'));`
  );
const connectors = () =>
  Number(
    exec(
      "import fs from 'node:fs';let count=0;for(const p of fs.readdirSync('/proc')){try{if(fs.readFileSync('/proc/'+p+'/comm','utf8').trim()==='cloudflared')count++;}catch{}}process.stdout.write(String(count));"
    )
  );
const toggle = (enabled) =>
  JSON.parse(
    exec(
      `import fs from 'node:fs';const creds=JSON.parse(fs.readFileSync('/data/_smoke_credentials'));const login=await(await fetch('http://127.0.0.1:9090/account/signin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...creds,moarTubeNodeHttpProtocol:'http',moarTubeNodeIp:'127.0.0.1',moarTubeNodePort:'9090'})})).json();if(!login.token)throw Error('Smoke login failed');const r=await fetch('http://127.0.0.1:9090/settings/cloudflare/tunnel/toggle',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+login.token},body:JSON.stringify({isEnabled:${enabled}})});const result=await r.json();if(!r.ok||result.isError)throw Error('Smoke toggle failed '+r.status);process.stdout.write(JSON.stringify({enabled:result.isCloudflareTunnelEnabled}));`
    )
  );
async function until(action, timeout = 60000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const r = await action();
      if (r) return r;
    } catch (e) {
      last = e;
    }
    await delay(1000);
  }
  throw last ?? new Error('Timed out');
}
let browser;
const results = [];
async function playback(base, embed = false) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/external/') && url.origin !== base) {
      errors.push('Wrong media/resource origin: ' + request.url());
    }
  });
  page.on('requestfailed', (request) => {
    if (
      request.url().startsWith(base + '/') &&
      request.failure()?.errorText !== 'net::ERR_ABORTED'
    ) {
      errors.push('Failed request: ' + request.url());
    }
  });
  page.on('response', (r) => {
    if (r.url().startsWith(base + '/external/') && r.status() >= 400)
      errors.push('HTTP ' + r.status() + ' ' + r.url());
  });
  const ws = [];
  let registered = false;
  page.on('websocket', (s) => {
    ws.push(s.url());
    s.on('framereceived', ({ payload }) => {
      try {
        if (JSON.parse(String(payload)).eventName === 'registered') registered = true;
      } catch {}
    });
  });
  try {
    await page.goto(base + (embed ? '/watch/embed/video/' + id : '/watch?v=' + id), {
      waitUntil: 'networkidle',
      timeout: 45000,
    });
    if (!embed) {
      if (new URL(base).hostname.endsWith('.trycloudflare.com')) {
        assert.equal(await page.evaluate('moarTubeWatch.NODE_BASE_URL'), base);
      }
      await page.evaluate('moarTubeWatch.connectWebsocket()');
      await until(() => registered, 10000);
    }
    if (embed) await page.locator('.mtp-large-play-button').click();
    const player = page.locator('hlsjs-video');
    await player.waitFor({ state: 'attached', timeout: 15000 });
    await player.evaluate((el) => {
      el.muted = true;
      void el.play().catch(() => {});
    });
    await page.waitForFunction(
      () => document.querySelector('hlsjs-video')?.currentTime > 0.5,
      {},
      { timeout: 20000 }
    );
    await player.evaluate((el) => {
      el.currentTime = 2;
    });
    await page.waitForFunction(
      () => document.querySelector('hlsjs-video')?.currentTime > 2.2,
      {},
      { timeout: 15000 }
    );
    assert.deepEqual(errors, []);
    if (!embed)
      assert.ok(
        ws.some((url) => new URL(url).origin === new URL(base.replace(/^http/, 'ws')).origin),
        'Viewer WebSocket origin'
      );
    console.log('Playback passed', base, embed ? 'embed' : 'watch');
    results.push({ base, embed, playback: true, seeking: true, errors: 0, websocket: ws.length });
  } finally {
    await page.close();
  }
}
try {
  docker(
    'run',
    ...(process.env.MOARTUBE_NODE_PLATFORM
      ? ['--platform', process.env.MOARTUBE_NODE_PLATFORM]
      : []),
    '-d',
    '--name',
    name,
    '-e',
    'MOARTUBE_WORKERS=2',
    '-p',
    '127.0.0.1::9090',
    '--mount',
    `type=bind,source=${fixture},target=/tmp/fixture,readonly`,
    process.env.MOARTUBE_NODE_IMAGE ?? 'moartube-node:url-audit',
    'node',
    '/tmp/fixture/bootstrap.mjs'
  );
  const address = docker('port', name, '9090/tcp');
  let direct = 'http://' + address;
  await until(async () => {
    const r = await fetch(direct + '/watch?v=' + id, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  });
  const quick = await until(() => {
    const s = settings();
    return s.cloudflareTunnelName && 'https://' + s.cloudflareTunnelName + '.trycloudflare.com';
  });
  await until(async () => {
    const r = await fetch(quick + '/watch?v=' + id, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  }, 90000);
  console.log('Quick endpoint ready');
  assert.equal(connectors(), 1);
  const original = storedHash();
  browser = await chromium.launch({ headless: true });
  await playback(direct);
  await playback(quick);
  await playback(quick, true);
  assert.equal(toggle(false).enabled, false);
  await until(() => connectors() === 0);
  await playback(direct);
  assert.equal(storedHash(), original);
  docker('restart', name);
  direct = 'http://' + docker('port', name, '9090/tcp');
  await until(async () => {
    const r = await fetch(direct + '/watch?v=' + id, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  });
  assert.equal(connectors(), 0);
  assert.equal(settings().isCloudflareTunnelEnabled, false);
  await playback(direct);
  assert.equal(toggle(true).enabled, true);
  const next = await until(() => {
    const s = settings();
    const url = 'https://' + s.cloudflareTunnelName + '.trycloudflare.com';
    return url !== quick && url;
  });
  await until(async () => {
    const r = await fetch(next + '/watch?v=' + id, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  }, 90000);
  await playback(next);
  assert.equal(connectors(), 1);
  assert.equal(storedHash(), original);
  fs.writeFileSync(
    path.join(root, 'smoke-results.json'),
    JSON.stringify(
      { results, offRestart: true, freshHostname: true, storedManifestUnchanged: true },
      null,
      2
    )
  );
  console.log(
    'Browser playback, seeking, WebSockets, off/restart/on and hostname rotation passed.'
  );
} finally {
  await browser?.close();
  try {
    docker('stop', '--time', '15', name);
    console.log('Container exit:', docker('inspect', '--format', '{{.State.ExitCode}}', name));
  } finally {
    docker('rm', '-v', name);
  }
}
