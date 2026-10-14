import ts from 'typescript'
import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const code = ts.transpile(fs.readFileSync(new URL('../src/lib.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS })
for (const suffix of ['', '1', '2', '999']) {
  for (const page of ['join', 'screen', 'teacher']) {
    const calls = [], streams = []
    const context = {
      exports: {}, URL, location: { pathname: `/${page}${suffix}/`, origin: 'https://chinacore.alumos.cn' },
      require: () => ({ useState: value => [value, () => {}], useEffect: fn => fn() }),
      fetch: async path => { calls.push(path); return { ok: true, json: async () => ({}) } },
      EventSource: class { constructor(path) { streams.push(path) } addEventListener() {} close() {} },
    }
    vm.runInNewContext(code, context)
    const lib = context.exports, room = suffix || '1'
    assert.equal(lib.currentPage, page)
    assert.equal(lib.roomID, room)
    for (const destination of ['join', 'screen', 'teacher']) assert.equal(lib.pageURL(destination), `/${destination}${suffix}`)
    await lib.api('/api/messages', 'POST', {})
    lib.useClassroom(); lib.useClassroom(true)
    assert.deepEqual(calls, [`/api/messages?room=${room}`])
    assert.deepEqual(streams, [`/api/events?room=${room}`, `/api/admin/events?room=${room}`])
    assert.equal(lib.roomAPI('/api/admin/export'), `/api/admin/export?room=${room}`)
  }
}
console.log('All 12 classroom entry combinations preserve numbered links, submissions, SSE and exports.')
